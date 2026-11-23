// Optional local image-model review, separate from fast transcript/activity picking.
(()=>{
 const panel=document.createElement('details');panel.className='panel';panel.innerHTML='<summary><b>Visual review</b> · look at actual scene frames</summary><p class="muted">A local image model describes three sampled frames. This is slower and can be uncertain; it does not verify a full game event or a viral outcome.</p><p id="vision-model">Checking the local visual model…</p><label class="check"><input type="checkbox" id="vision-auto"> Use visual review when choosing automatic clips (slower)</label><button id="vision-review">Review selected scene</button><p id="vision-note" role="status"></p><div id="vision-results"></div>';
 $('source').closest('section').after(panel);
 const note=text=>$('vision-note').textContent=text;
 const originalRequest=window.request;
 window.request=function(path,body){if(path==='/make'&&body)body={...body,vision_review:$('vision-auto').checked};return originalRequest(path,body);};
 request('/vision/status').then(result=>{$('vision-model').textContent=result.model?'Local visual model: '+result.model:'A compatible local Gemma4 vision model is required. No model is downloaded automatically.';$('vision-review').disabled=!result.model;$('vision-auto').disabled=!result.model;}).catch(error=>note(error.message));
 $('vision-review').onclick=async()=>{
  const button=$('vision-review');button.disabled=true;
  try{await requireSource();const sourceId=id,range=signature();note('Reading three scene frames locally…');$('vision-results').replaceChildren();const {job}=await request('/vision/review',{id:sourceId,start:Number($('start').value),end:Number($('end').value)});
   for(;;){const state=await request('/status/'+job);if(state.status==='error')throw Error(state.error);if(state.status==='done'){if(id!==sourceId||signature()!==range)throw Error('Selected scene changed; review it again.');appendVisualReview($('vision-results'),state.review);note('Three frames reviewed'+(state.review.cached?' · saved review reused':' in '+state.review.seconds+'s')+'. Check the observations against the frames.');break;}note(state.message||'Reading frames locally…');await sleep(1000);}
  }catch(error){note(error.message);}finally{button.disabled=false;}
 };
})();
