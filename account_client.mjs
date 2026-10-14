export function createAccountClient({onSession,onSignedOut,onError}) {
  let current=null,pending=Promise.resolve(true),saving=0,generation=0;
  async function request(path,method='GET',body) {
    const response=await fetch(path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const payload=await response.json();
    if(!response.ok){const err=new Error(payload.error||'Não foi possível concluir esta ação.');err.code=response.status;throw err;}
    return payload;
  }
  function publish(session){current=session;onSession(session);}
  async function sync(){if(!current||saving)return;const captured=generation;try{const next=await request('/api/state');if(captured!==generation||!current)return;if(next.revision!==current.revision)publish(next);}catch(err){if(captured!==generation)return;if(err.code===401){current=null;generation++;onSignedOut();onError('Sua sessão terminou. Entre novamente.');}else onError(err.message);}}
  return {
    get current(){return current;},get saving(){return saving>0;},
    async ready(){try{publish(await request('/api/session'));}catch(err){if(err.code!==401)onError('O modo de contas está indisponível. A demonstração continua funcionando.');}},
    async login(data){const captured=++generation;const next=await request('/api/login','POST',data);if(captured===generation)publish(next);},
    async register(data){const captured=++generation;const next=await request('/api/register','POST',data);if(captured===generation)publish(next);},
    async logout(){await pending;generation++;await request('/api/logout','POST',{});current=null;onSignedOut();},
    async deleteAccount(data){await pending;generation++;await request('/api/account','DELETE',data);current=null;onSignedOut();},
    save(nextState){
      const captured=generation;saving++;
      pending=pending.then(async()=>{
        if(captured!==generation||!current)return false;
        try{
          const next=await request('/api/state','PUT',{state:nextState,expectedRevision:current.revision});
          if(captured!==generation)return false;
          current=next;
          return true;
        }catch(err){
          if(captured!==generation)return false;
          const reloading=++generation;
          try{const authoritative=await request('/api/state');if(reloading!==generation)return false;current=authoritative;onSession(current);}catch{}
          if(reloading!==generation)return false;
          onError(err.code===409?'Outra pessoa atualizou a turma. Carreguei a versão mais recente; confira e repita sua alteração.':err.message);
          return false;
        }
      }).finally(()=>{saving--;if(saving===0&&captured===generation&&current)onSession(current);});
      return pending;
    },
    flush(){return pending;},sync,
  };
}
