"""Persistent local processing queue with pause, scheduled starts and explicit interrupted-job retry."""
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from fastapi import HTTPException

class JobQueue:
    def __init__(self,path,handlers,state,autostart=True):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        self.handlers=handlers;self.state=state;self.wake=threading.Event();self.stopped=threading.Event()
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT,payload TEXT,status TEXT,created REAL,updated REAL,not_before REAL,child TEXT,result TEXT,attempts INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT)')
            db.execute("UPDATE jobs SET status='interrupted',updated=? WHERE status='running'",(time.time(),))
        if autostart:
            self.worker=threading.Thread(target=self.run,daemon=True);self.worker.start()

    def connect(self):
        db=sqlite3.connect(self.path,timeout=10);db.row_factory=sqlite3.Row;return db

    def rows(self):
        with self.connect() as db:rows=db.execute('SELECT * FROM jobs ORDER BY created DESC').fetchall()
        return [self.decode(row) for row in rows]

    @staticmethod
    def decode(row):
        item=dict(row);item['payload']=json.loads(item['payload']);item['result']=json.loads(item['result'] or '{}')
        return item

    def get(self,job):
        with self.connect() as db:row=db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone()
        if row is None:raise HTTPException(404,'Queued job not found.')
        return self.decode(row)

    def enqueue(self,kind,payload,not_before=0):
        if kind not in self.handlers:raise HTTPException(400,'Unsupported processing job.')
        job=uuid.uuid4().hex;now=time.time()
        with self.connect() as db:
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',(job,kind,json.dumps(payload),'queued',now,now,not_before,None,'{}',0))
        self.wake.set();return self.get(job)

    def paused(self):
        with self.connect() as db:row=db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
        return bool(row and row['value']=='1')

    def pause(self,value):
        with self.connect() as db:db.execute("INSERT OR REPLACE INTO settings VALUES('paused',?)",('1' if value else '0',))
        self.wake.set()

    def change(self,job,action):
        row=self.get(job)
        if action=='cancel':
            if row['status']!='queued':raise HTTPException(409,'Only waiting jobs can be canceled here. Running work is preserved.')
            status='canceled'
        elif action=='retry':
            if row['status'] not in ('error','interrupted','canceled'):raise HTTPException(409,'Only failed, interrupted or canceled jobs can be retried.')
            status='queued'
        else:raise HTTPException(400,'Choose retry or cancel.')
        with self.connect() as db:
            db.execute('UPDATE jobs SET status=?,child=NULL,result=?,updated=?,not_before=? WHERE id=?',(status,'{}',time.time(),0,job))
        self.wake.set();return self.get(job)

    def claim(self):
        if self.paused():return None
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT * FROM jobs WHERE status='queued' AND not_before<=? ORDER BY created LIMIT 1",(time.time(),)).fetchone()
            if row is None:return None
            db.execute("UPDATE jobs SET status='running',attempts=attempts+1,updated=? WHERE id=?",(time.time(),row['id']))
        return self.get(row['id'])

    def run_once(self):
        job=self.claim()
        if job is None:return False
        try:
            started=self.handlers[job['kind']](job['payload']);child=started['job']
            with self.connect() as db:db.execute('UPDATE jobs SET child=? WHERE id=?',(child,job['id']))
            while not self.stopped.is_set():
                result=dict(self.state.get(child,{}))
                if result.get('status') not in ('running','queued',None):break
                with self.connect() as db:db.execute('UPDATE jobs SET result=?,updated=? WHERE id=?',(json.dumps(result),time.time(),job['id']))
                self.stopped.wait(.4)
            if self.stopped.is_set():return True
            status='done' if result.get('status')=='done' else 'error'
        except Exception as error:
            status='error';result={'status':'error','error':str(getattr(error,'detail',error))[-1000:]}
        with self.connect() as db:
            db.execute('UPDATE jobs SET status=?,result=?,updated=? WHERE id=?',(status,json.dumps(result),time.time(),job['id']))
        return True

    def run(self):
        while not self.stopped.is_set():
            if not self.run_once():self.wake.wait(.5);self.wake.clear()

    def close(self):
        self.stopped.set();self.wake.set()
        if hasattr(self,'worker'):self.worker.join(timeout=2)

def attach(app,data,state,handlers):
    queue=JobQueue(Path(data)/'jobs.sqlite3',handlers,state)
    app.processing_queue=queue

    @app.get('/queue')
    def listing():
        return {'paused':queue.paused(),'jobs':queue.rows(),
                'policy':'Queued processing jobs run sequentially; existing render acceleration is unchanged. Interrupted jobs wait for explicit retry.'}

    @app.post('/queue')
    def add(body:dict):
        payload=body.get('payload')
        if not isinstance(payload,dict):raise HTTPException(400,'Provide job settings.')
        kind=str(body.get('kind','make'))
        if kind=='make' and not (payload.get('url') or payload.get('id')):raise HTTPException(400,'Choose a source video.')
        try:
            when=float(body.get('not_before',0))
            if not 0<=when<time.time()+366*86400:raise ValueError()
        except (ValueError,TypeError,OverflowError):raise HTTPException(400,'Choose a valid start time within one year.')
        return queue.enqueue(kind,payload,when)

    @app.post('/queue/pause')
    def pause(body:dict):queue.pause(bool(body.get('paused')));return {'paused':queue.paused()}

    @app.post('/queue/{job}/{action}')
    def action(job:str,action:str):return queue.change(job,action)
