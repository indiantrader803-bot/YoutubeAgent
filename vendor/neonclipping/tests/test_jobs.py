from pathlib import Path
import tempfile
import time
import unittest
from fastapi import HTTPException
from jobs import JobQueue

class DurableQueue(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory(ignore_cleanup_errors=True);self.addCleanup(self.folder.cleanup)
        self.path=Path(self.folder.name)/'jobs.sqlite3';self.state={};self.calls=[]
        def handler(payload):
            self.calls.append(payload);child='child'+str(len(self.calls));self.state[child]={'status':'done','value':payload['value']};return {'job':child}
        self.handlers={'export':handler}
        self.queue=JobQueue(self.path,self.handlers,self.state,autostart=False)

    def test_pause_and_resume_preserve_payload_and_order(self):
        one=self.queue.enqueue('export',{'value':1});self.queue.enqueue('export',{'value':2})
        self.queue.pause(True);self.assertFalse(self.queue.run_once());self.assertEqual(self.calls,[])
        restarted=JobQueue(self.path,self.handlers,self.state,autostart=False)
        self.assertTrue(restarted.paused());restarted.pause(False)
        self.assertTrue(restarted.run_once());self.assertTrue(restarted.run_once())
        self.assertEqual([p['value'] for p in self.calls],[1,2]);self.assertEqual(restarted.get(one['id'])['status'],'done')

    def test_scheduled_and_canceled_jobs_do_not_run(self):
        future=self.queue.enqueue('export',{'value':1},time.time()+1000)
        canceled=self.queue.enqueue('export',{'value':2});self.queue.change(canceled['id'],'cancel')
        self.assertFalse(self.queue.run_once());self.assertEqual(self.calls,[])
        self.queue.change(canceled['id'],'retry');self.assertTrue(self.queue.run_once())
        self.assertEqual(self.calls,[{'value':2}]);self.assertEqual(self.queue.get(future['id'])['status'],'queued')

    def test_restart_marks_running_job_interrupted_without_duplicate_execution(self):
        item=self.queue.enqueue('export',{'value':3});self.queue.claim()
        restarted=JobQueue(self.path,self.handlers,self.state,autostart=False)
        self.assertEqual(restarted.get(item['id'])['status'],'interrupted');self.assertFalse(restarted.run_once())
        restarted.change(item['id'],'retry');self.assertTrue(restarted.run_once());self.assertEqual(len(self.calls),1)

    def test_failed_handler_records_error_and_accepts_retry(self):
        def broken(payload):raise ValueError('Controlled render failure')
        self.queue.handlers={'export':broken};item=self.queue.enqueue('export',{'value':1});self.queue.run_once()
        self.assertEqual(self.queue.get(item['id'])['status'],'error')
        self.assertIn('Controlled render failure',self.queue.get(item['id'])['result']['error'])
        with self.assertRaises(HTTPException):self.queue.change(item['id'],'unknown')

if __name__=='__main__':unittest.main()
