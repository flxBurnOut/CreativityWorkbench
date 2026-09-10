// One current request, no retained response cache. Explicit refresh and project
// changes cancel stale reads; even an adapter ignoring abort cannot overwrite UI.
export function createTaskPoller({load,onData,onError}) {
  let active,sequence=0;
  const cancel=()=>{sequence++;active?.controller.abort();active=undefined;};
  function refresh(projectId,{force=false,visible=true}={}) {
    if(!projectId||(!visible&&!force))return Promise.resolve();
    if(active?.projectId===projectId&&!force)return active.promise;
    cancel();const token=sequence,controller=new AbortController();
    const operation={projectId,controller,promise:undefined};active=operation;
    operation.promise=(async()=>{
      try{const data=await load(projectId,controller.signal);if(!controller.signal.aborted&&token===sequence)onData(data,projectId,force);}
      catch(error){if(!controller.signal.aborted&&token===sequence)onError(error,projectId);}
      finally{if(token===sequence)active=undefined;}
    })();
    return operation.promise;
  }
  return {refresh,cancel};
}
