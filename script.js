/* ========= Utilidades de data ========= */
const HOJE = new Date(); HOJE.setHours(0,0,0,0);
const iso = d => { const x=new Date(d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
const addDias = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const dataDe = s => { const [a,m,d]=s.split('-').map(Number); return new Date(a,m-1,d); };
const diasEntre = (a,b) => Math.round((dataDe(b)-dataDe(a))/86400000);
const fmtData = s => { const d=dataDe(s); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); };
const DIAS = ['dom','seg','ter','qua','qui','sex','sáb'];
const brl = v => v==null?'—': 'R$ '+Number(v).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2,9);
const durTxt = m => m<60 ? m+' min' : Math.floor(m/60)+' h'+(m%60?' '+(m%60)+' min':'');
const PORTES = {carro:'Carro',suv:'Picape/SUV',moto:'Moto'};

/* ========= Supabase: conexão, leitura e gravação =========
   D é uma cópia local, no formato que as telas usam, montada a partir do banco.
   Toda alteração vai ao Supabase e depois recarrega D (função acao). */
const sb = supabase.createClient(window.VIZZANI_CONFIG.supabaseUrl, window.VIZZANI_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'vizzani-sessao' },
});
const FUNCOES = window.VIZZANI_CONFIG.supabaseUrl + '/functions/v1/';
const emailDoFone = fone => `55${fone}@vizzani.app`;
const hm = t => t ? String(t).slice(0,5) : t;          // '08:00:00' → '08:00'
const num = x => x == null ? null : Number(x);
const dataLocal = ts => iso(new Date(ts));             // timestamp do banco → 'AAAA-MM-DD' no fuso do aparelho
let D = null, sessao = null, perfil = null, licenca = null, suporte = false, painelLic = null;

async function q(promessa){ const { data, error } = await promessa; if(error) throw error; return data; }
function msgErro(e){
  const m = e?.message || String(e || '');
  if(/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Sem conexão com a internet. Tente de novo.';
  if(/JWT expired|invalid JWT|not authenticated/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if(/duplicate key.*placa|veiculos_pkey/i.test(m)) return 'Essa placa já está cadastrada.';
  if(/duplicate key.*fone/i.test(m)) return 'Esse WhatsApp já está cadastrado.';
  return m.replace(/^.*?ERROR:\s*/, '');
}
function carregando(on){ document.body.classList.toggle('ocupado', on); }
// Executa uma alteração no banco, mostra erro em português, recarrega os dados e redesenha a tela
async function acao(fn, msgOk){
  // Evita gravar duas vezes por toque duplo: enquanto uma alteração está em andamento, as outras esperam
  if(acao.rodando){ aviso('Aguarde, salvando…'); return false; }
  acao.rodando = true; carregando(true);
  try{ const r = await fn(); await carregar(); if(msgOk) aviso(msgOk); render(); return r === undefined ? true : r; }
  catch(e){ console.error(e); aviso(msgErro(e)); try{ await carregar(); }catch(_){} render(); return false; }
  finally{ acao.rodando = false; carregando(false); }
}
// Chama a Edge Function "conta" (criar conta, primeiro acesso, liberar senha)
async function chamarConta(corpo){
  const token = sessao?.access_token;
  const r = await fetch(FUNCOES + 'conta', { method:'POST', headers:{ 'Content-Type':'application/json', apikey: window.VIZZANI_CONFIG.supabaseKey, ...(token?{Authorization:'Bearer '+token}:{}) }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(()=>({ erro:'Resposta inválida do servidor.' }));
  if(!r.ok) { const e = new Error(j.erro || 'Não foi possível concluir.'); e.codigo = j.codigo; throw e; }
  return j;
}

async function carregar(){
  // Licença do sistema (mensalidade): vencida, o servidor para de liberar dados; aqui só mostramos o aviso certo
  try{ licenca = (await q(sb.rpc('licenca_status')))[0] || null; }catch(e){ licenca = null; }
  if(suporte){ try{ painelLic = (await q(sb.rpc('licenca_painel')))[0] || null; }catch(e){ painelLic = null; } }
  const dono = perfil?.papel === 'dono';
  const [cfg, exp, servs, bloqs] = await Promise.all([
    q(sb.from('config').select('*').eq('id', 1).single()),
    q(sb.from('expediente').select('*').order('dia_semana')),
    q(sb.from('servicos').select('*').order('ordem')),
    q(sb.from('bloqueios').select('*').gte('data', iso(addDias(HOJE, -7)))),
  ]);
  const N = {
    loja: cfg.loja || {},
    config: {
      capacidade: cfg.capacidade, sinal: Number(cfg.sinal), chuvaHoras: cfg.chuva_horas, fotosDias: cfg.fotos_dias,
      pontosResgate: cfg.pontos_resgate, intervaloLavagem: cfg.intervalo_lavagem, clubeLavagens: cfg.clube_lavagens,
      clubePrecos: { carro: Number(cfg.clube_preco_carro), suv: Number(cfg.clube_preco_suv), moto: Number(cfg.clube_preco_moto) },
      semana: [0,1,2,3,4,5,6].map(i => { const e = exp.find(x => x.dia_semana === i); return e ? { fechado: e.fechado, abre: hm(e.abre), fecha: hm(e.fecha) } : { fechado: true, abre: '08:00', fecha: '18:00' }; }),
      passo: cfg.passo_min, pausa: { ativa: cfg.pausa_ativa, ini: hm(cfg.pausa_ini), fim: hm(cfg.pausa_fim) },
      antecedencia: Number(cfg.antecedencia_h), prazoCancelar: Number(cfg.prazo_cancelar_h), diasAgenda: cfg.dias_agenda,
      fotosDepois: cfg.fotos_depois, baixaAuto: cfg.baixa_auto_estoque,
    },
    servicos: servs.filter(s => s.ativo || dono).map(s => ({ id: s.id, nome: s.nome, dur: s.duracao_min, precos: { carro: num(s.preco_carro), suv: num(s.preco_suv), moto: num(s.preco_moto) },
      apartir: s.a_partir_de, lavagem: s.lavagem, noClube: s.no_clube ?? s.lavagem, destaque: s.destaque, inclui: s.inclui || '' })),
    bloqueios: bloqs.map(b => ({ id: b.id, data: b.data, diaTodo: b.dia_todo, ini: hm(b.inicio) || '00:00', fim: hm(b.fim) || '23:59', motivo: b.motivo })),
    clientes: [], veiculos: [], at: [], pendencias: [], avisos: {}, clube: {}, resgatesPts: {}, recados: [], notifs: [],
    lancamentos: [], produtos: [], estoqueMov: [],
  };
  if(!perfil){ D = N; return; }

  let consultaAt = sb.from('atendimentos').select('*, vistorias(*), fotos(id,caminho,momento,criada_em)').order('data').order('hora');
  if(dono) consultaAt = consultaAt.gte('data', iso(addDias(HOJE, -400)));
  const base = [
    q(consultaAt), q(sb.from('clientes').select('*')), q(sb.from('veiculos').select('*')),
    q(sb.from('pendencias').select('*')), q(sb.from('clube_assinaturas').select('*')), q(sb.from('resgates').select('cliente_id,pontos')),
  ];
  const extra = dono ? [
    q(sb.from('avisos_retorno').select('*')),
    q(sb.from('notificacoes_dono').select('*').or(`lido_em.is.null,criado_em.gte.${addDias(HOJE, -30).toISOString()}`).order('criado_em', { ascending: false })),
    q(sb.from('lancamentos').select('*').gte('data', iso(addDias(HOJE, -400)))),
    q(sb.from('produtos').select('*, produto_consumo(servico_id,qtd)').eq('ativo', true).order('nome')),
    q(sb.from('estoque_movimentos').select('*').gte('criado_em', addDias(HOJE, -90).toISOString()).order('criado_em', { ascending: false })),
    q(sb.from('perfis').select('cliente_id').not('cliente_id', 'is', null)),
  ] : [
    q(sb.from('recados').select('*').order('criado_em', { ascending: false }).limit(30)),
  ];
  const [ats, clis, veics, pends, clubes, resg] = await Promise.all(base);
  const outros = await Promise.all(extra);

  N.at = ats.map(a => {
    const v = Array.isArray(a.vistorias) ? a.vistorias[0] : a.vistorias, fotos = a.fotos || [];
    return { id: a.id, placa: a.placa, clienteId: a.cliente_id, servicoId: a.servico_id, data: a.data, hora: hm(a.hora), status: a.status,
      valor: Number(a.valor), valorTabela: num(a.valor_tabela), desconto: Number(a.desconto_pct || 0),
      extra: a.extra_valor ? { desc: a.extra_desc, valor: Number(a.extra_valor) } : null,
      pago: a.pago, forma: a.forma_pagto, sinal: a.sinal, sinalStatus: a.sinal_status, sinalDevolvido: !!a.sinal_devolvido_em,
      clube: a.clube, chuva: a.chuva, resgate: a.resgate, pontos: a.pontos, origem: a.origem, atraso: a.atraso_min,
      remarcadoDe: a.remarcado_de, canceladoPor: a.cancelado_por, motivoCancel: a.motivo_cancel, nota: a.nota, comentario: a.comentario,
      lembrete: a.lembrete_em, confirmado: a.confirmado,
      vistoria: v ? { avarias: v.avarias || [], obs: v.obs || '', ciente: v.ciente, quando: v.quando, manter: v.manter,
        fotos: fotos.filter(f => f.momento === 'antes'), fotosApagadas: v.fotos_apagadas_qtd } : null,
      depois: fotos.some(f => f.momento === 'depois') ? { fotos: fotos.filter(f => f.momento === 'depois') } : (a.fotos_depois_apagadas_em ? { fotos: [], apagadas: true } : null),
    };
  });
  const comLogin = dono ? new Set(outros[5].map(p => p.cliente_id)) : new Set([perfil.cliente_id]);
  N.clientes = clis.map(c => ({ id: c.id, nome: c.nome, fone: c.fone, consente: c.consente, temLogin: comLogin.has(c.id), criadoPeloApp: c.criado_pelo_app, criadoEm: c.criado_em }));
  N.veiculos = veics.map(v => ({ placa: v.placa, modelo: v.modelo, porte: v.porte, clienteId: v.cliente_id }));
  N.pendencias = pends.map(p => ({ id: p.id, placa: p.placa, modelo: p.modelo, porte: p.porte, clienteId: p.cliente_id, quando: p.criado_em }));
  clubes.forEach(c => N.clube[c.cliente_id] = { desde: c.desde, porte: c.porte, ativo: c.ativo, pendente: !c.ativo && !c.cancelado_em });
  resg.forEach(r => N.resgatesPts[r.cliente_id] = (N.resgatesPts[r.cliente_id] || 0) + r.pontos);
  if(dono){
    const [avisos, notifs, lancs, prods, movs] = outros;
    avisos.sort((a,b) => a.enviado_em.localeCompare(b.enviado_em)).forEach(x => (N.avisos[x.cliente_id] = N.avisos[x.cliente_id] || []).push(dataLocal(x.enviado_em)));
    N.notifs = notifs.map(x => ({ id: x.id, texto: x.texto, atId: x.atendimento_id, quando: x.criado_em, lido: !!x.lido_em }));
    N.lancamentos = lancs.map(l => ({ id: l.id, data: l.data, tipo: l.tipo, desc: l.descricao, cat: l.categoria, valor: Number(l.valor), forma: l.forma,
      pessoa: l.pessoa || '', detalhes: l.detalhes || '', clienteId: l.cliente_id, criadoEm: l.criado_em }));
    N.produtos = prods.map(p => ({ id: p.id, nome: p.nome, un: p.unidade, qtd: Number(p.qtd), min: Number(p.minimo), custo: Number(p.custo),
      consumo: Object.fromEntries((p.produto_consumo || []).map(c => [c.servico_id, Number(c.qtd)])) }));
    N.estoqueMov = movs.map(m => ({ id: m.id, produtoId: m.produto_id, data: dataLocal(m.criado_em), quando: m.criado_em, tipo: m.tipo, qtd: Number(m.qtd), obs: m.obs, valor: num(m.valor) }));
  } else {
    N.recados = outros[0].map(r => ({ id: r.id, clienteId: r.cliente_id, atId: r.atendimento_id, texto: r.texto, quando: r.criado_em, lido: !!r.lido_em }));
    // Situação do Clube do próprio cliente (vem do servidor, porque o cliente não lê o caixa)
    try{ N.meuClube = (await q(sb.rpc('meu_clube')))[0] || null; }catch(e){ N.meuClube = null; }
  }
  D = N;
}

/* ---- Sessão: quem entrou define a tela (cliente ou painel do dono) ---- */
async function aoMudarSessao(s){
  sessao = s; perfil = null; suporte = false; painelLic = null;
  if(s){ try{ perfil = await q(sb.from('perfis').select('*').eq('id', s.user.id).single()); }catch(e){ console.error(e); } }
  if(perfil){
    try{ suporte = !!(await q(sb.rpc('sou_suporte'))); }catch(e){ suporte = false; }
    // 1º login do dono da loja: começa o período de teste grátis (logins do suporte não contam)
    if(perfil.papel === 'dono' && !suporte){ try{ await q(sb.rpc('iniciar_licenca')); }catch(e){ console.error(e); } }
  }
  modo = perfil?.papel === 'suporte' ? 'suporte' : perfil?.papel === 'dono' ? 'dono' : 'cliente';
  aba = modo === 'dono' ? 'hoje' : modo === 'suporte' ? 'licenca' : 'inicio';
  clienteAtual = perfil?.cliente_id || null;
  ag = {}; disp = {};
  try{ await carregar(); }catch(e){ console.error(e); aviso(msgErro(e)); }
  render();
}
/* ---- App instalável (PWA) ---- */
let pedidoInstalar = null;
const appInstalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; if(D) render(); });
window.addEventListener('appinstalled', () => { pedidoInstalar = null; aviso('App instalado! Procure o ícone da Vizzani na tela inicial.'); if(D) render(); });
function botaoInstalar(){
  if(appInstalado()) return '';
  if(pedidoInstalar) return `<button class="btn sec bloco" style="margin-top:12px" onclick="instalarApp()"><span>📲 Instalar o app no celular</span></button>`;
  if(ehIphone()) return `<button class="btn sec bloco" style="margin-top:12px" onclick="ajudaIphone()"><span>📲 Colocar o app na tela inicial</span></button>`;
  return '';
}
async function instalarApp(){ if(!pedidoInstalar) return; pedidoInstalar.prompt(); await pedidoInstalar.userChoice; pedidoInstalar = null; render(); }
function ajudaIphone(){
  abrirModal(`<h2 style="margin-top:0">Instalar no iPhone</h2>
    <ol class="sub" style="padding-left:20px;line-height:1.7">
      <li>Abra este app no <b>Safari</b>.</li>
      <li>Toque no botão <b>Compartilhar</b> (quadrado com seta para cima), embaixo da tela.</li>
      <li>Role e toque em <b>Adicionar à Tela de Início</b>.</li>
      <li>Toque em <b>Adicionar</b>. O ícone da Vizzani aparece junto dos seus apps.</li>
    </ol>
    <button class="btn sec bloco" onclick="fecharModal()"><span>Entendi</span></button>`);
}
async function iniciar(){
  hojeAtual();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e=>console.error('service worker', e));
  sb.auth.onAuthStateChange((evento, s) => {
    // chamadas ao Supabase dentro deste aviso precisam sair da fila (setTimeout)
    if(evento === 'SIGNED_OUT') setTimeout(() => aoMudarSessao(null));
    if(evento === 'PASSWORD_RECOVERY') setTimeout(() => { sessao = s; modalNovaSenha(); });
    if(evento === 'TOKEN_REFRESHED') sessao = s;
  });
  const { data } = await sb.auth.getSession();
  await aoMudarSessao(data.session);
  // Voltou para o app: atualiza (o dono vê agendamentos novos sem recarregar a página)
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && sessao) atualizarQuieto(); });
  setInterval(() => { if(document.visibilityState === 'visible' && sessao && !document.getElementById('modal').innerHTML) atualizarQuieto(); }, 60000);
}
async function atualizarQuieto(){
  if(hojeAtual()) disp = {};
  try{ await carregar(); if(!document.getElementById('modal').innerHTML) render(); }catch(e){ console.error(e); }
}
// Se o app ficou aberto de um dia para o outro, "hoje" avança
function hojeAtual(){ const h = new Date(); h.setHours(0,0,0,0); if(h.getTime() !== HOJE.getTime()){ HOJE.setTime(h.getTime()); return true; } return false; }

/* ========= Consultas ========= */
const servico = id => D.servicos.find(s=>s.id===id);
const veiculo = placa => D.veiculos.find(v=>v.placa===placa);
const cliente = id => D.clientes.find(c=>c.id===id);
const donoDe = placa => cliente(veiculo(placa)?.clienteId);
const veiculosDe = cid => D.veiculos.filter(v=>v.clienteId===cid);
const entreguesDe = placa => D.at.filter(a=>a.placa===placa && a.status==='entregue').sort((a,b)=>b.data.localeCompare(a.data));
const ultimaLavagem = placa => entreguesDe(placa).find(a=>servico(a.servicoId)?.lavagem || a.chuva);
function pontosDe(cid){
  const ganhos = D.at.filter(a=>a.status==='entregue' && donoAt(a)===cid).reduce((s,a)=>s+(a.pontos||0),0);
  return ganhos - (D.resgatesPts[cid]||0);
}
const noClube = cid => !!D.clube[cid]?.ativo;
// Lavagens do Clube usadas no mês (mês da data informada; padrão: mês atual). Cancelados não contam.
function usoClubeMes(cid, data=iso(HOJE), ignorar){
  const m = data.slice(0,7);
  return D.at.filter(a=>a.clube && a.id!==ignorar && a.data.slice(0,7)===m && a.status!=='cancelado' && donoAt(a)===cid).length;
}
// Uso do Clube no mês atual e nos próximos meses que já têm lavagem agendada (a lavagem conta no mês em que acontece)
function mesesClube(cid){
  const atual = iso(HOJE).slice(0,7), ms = new Set([atual]);
  D.at.forEach(a=>{ if(a.clube && a.status!=='cancelado' && a.data.slice(0,7)>atual && donoAt(a)===cid) ms.add(a.data.slice(0,7)); });
  return [...ms].sort().map(m=>({ nome: dataDe(m+'-01').toLocaleDateString('pt-BR',{month:'long'}), usos: usoClubeMes(cid, m+'-01'), atual: m===atual }));
}
// "setembro: 1 de 2 · outubro: 2 de 2"
const resumoClube = cid => mesesClube(cid).map(x=>`${x.nome}: ${x.usos} de ${D.config.clubeLavagens}`).join(' · ');
const proximosMesesClube = cid => mesesClube(cid).filter(x=>!x.atual).map(x=>`${x.nome}: ${x.usos} de ${D.config.clubeLavagens} já agendada${x.usos>1?'s':''}`).join(' · ');
// Mesmas regras do servidor (009): só lavagem, seg–sex, assinatura ativa, limite por mês
function clubeElegivel(cid, sid, data){
  if(!noClube(cid)) return {ok:false};
  const s = servico(sid), dow = dataDe(data).getDay(), usados = usoClubeMes(cid, data), lim = D.config.clubeLavagens;
  const mes = dataDe(data).toLocaleDateString('pt-BR',{month:'long'});
  if(!s?.noClube) return {ok:false, motivo:'Este serviço não está incluído no Clube.'};
  if(dow<1 || dow>5) return {ok:false, motivo:'As lavagens do Clube valem de segunda a sexta.'};
  if(usados>=lim) return {ok:false, motivo:`Já usou as ${lim} lavagens do Clube de ${mes}.`};
  const st = statusClube(cid);
  return {ok:true, restam:lim-usados, mes, atraso: st?.tipo==='aberto' && st.atraso>0 ? st.atraso : 0};
}
const nomesNoClube = () => { const n = D.servicos.filter(s=>s.noClube).map(s=>s.nome.toLowerCase()); return n.length ? n.join(', ') : 'nenhum serviço definido'; };
const avisoClubeHTML =(cid, el, marcado, onchange) => !noClube(cid) ? '' : el.ok
  ? `<label class="check info" style="display:flex;margin-top:12px"><input type="checkbox" ${marcado?'checked':''} onchange="${onchange}"> <span><b>Usar lavagem do Clube</b> (sem cobrança, sem sinal) · restam ${el.restam} de ${D.config.clubeLavagens} em ${el.mes}${el.atraso?`<br><span class="sai">⚠ Mensalidade atrasada há ${el.atraso} dia${el.atraso>1?'s':''}.</span>`:''}</span></label>`
  : `<p class="mudo pequeno" style="margin-top:10px">⭐ Cliente do Clube, mas este agendamento será cobrado: ${esc(el.motivo)}</p>`;
/* ---- Agenda: expediente, bloqueios e ocupação pela duração real do serviço ---- */
const mins = h => Number(h.slice(0,2))*60 + Number(h.slice(3,5));
const hhmm = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const OCUPA = a => !['cancelado','faltou','entregue'].includes(a.status);
function expediente(data){
  const dia = D.config.semana[dataDe(data).getDay()];
  if(!dia || dia.fechado || D.bloqueios.some(b=>b.data===data && b.diaTodo)) return null;
  return {abre:mins(dia.abre), fecha:mins(dia.fecha)};
}
const naPausa = m => D.config.pausa.ativa && m>=mins(D.config.pausa.ini) && m<mins(D.config.pausa.fim);
const bloqueioEm = (data,m) => D.bloqueios.find(b=>b.data===data && (b.diaTodo || (m>=mins(b.ini) && m<mins(b.fim))));
function horariosDo(data){
  const e = expediente(data), r = []; if(!e) return r;
  for(let m=e.abre; m<e.fecha; m+=D.config.passo) if(!naPausa(m) && !bloqueioEm(data,m)) r.push(hhmm(m));
  return r;
}
function fimAt(a){ const e = expediente(a.data), f = mins(a.hora)+(servico(a.servicoId)?.dur||60); return e?Math.min(f,e.fecha):f; }
function ocupacao(data,hora,ignorar){
  const m = mins(hora), fim = m + D.config.passo;
  return D.at.filter(a=>a.data===data && a.id!==ignorar && OCUPA(a) && mins(a.hora)<fim && fimAt(a)>m).length;
}
// O serviço cabe se todos os horários que ele ocupa ainda têm vaga (serviço longo prende a vaga o dia todo)
function cabe(data,hora,dur,ignorar){
  const e = expediente(data); if(!e || !horariosDo(data).includes(hora)) return false;
  const ini = mins(hora), fim = Math.min(ini+dur, e.fecha);
  if(D.bloqueios.some(b=>b.data===data && !b.diaTodo && mins(b.ini)<fim && mins(b.fim)>ini)) return false;
  return horariosDo(data).filter(h=>mins(h)+D.config.passo>ini && mins(h)<fim).every(h=>ocupacao(data,h,ignorar)<D.config.capacidade);
}
function jaPassou(data,hora,antecedenciaH=0){
  if(data!==iso(HOJE)) return data<iso(HOJE);
  const n = new Date(); return mins(hora) < n.getHours()*60+n.getMinutes()+antecedenciaH*60;
}
const livreCliente = (data,hora,dur,ignorar) => !jaPassou(data,hora,D.config.antecedencia) && cabe(data,hora,dur,ignorar);
const horasAte = a => (dataDe(a.data).getTime() + mins(a.hora)*60000 - Date.now())/3600000;
function garantiaChuva(placa){
  const ult = entreguesDe(placa)[0];
  if(!ult || !servico(ult.servicoId)?.lavagem) return null;
  const horas = diasEntre(ult.data, iso(HOJE))*24;
  if(horas > D.config.chuvaHoras) return null;
  if(D.at.some(a=>a.placa===placa && a.chuva && a.data>=ult.data)) return null;
  return ult;
}

/* ========= Componentes ========= */
const placaHTML = (p,mini) => `<span class="placa${mini?' mini':''}" aria-label="Placa ${esc(p)}"><span class="faixa"><span>BRASIL</span><span>🇧🇷</span></span><span class="num">${esc(p.slice(0,3))}${esc(p.slice(3))}</span></span>`;
function aviso(msg){ const el=document.getElementById('aviso'); el.textContent=msg; el.classList.add('show'); clearTimeout(aviso.t); aviso.t=setTimeout(()=>el.classList.remove('show'),2600); }
function linkZap(fone,texto){ return 'https://api.whatsapp.com/send?phone=55'+fone.replace(/\D/g,'')+'&text='+encodeURIComponent(texto); }
function abrirModal(html){ document.getElementById('modal').innerHTML = `<div class="modal-fundo" onclick="if(event.target===this)fecharModal()"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; }
function fecharModal(){ document.getElementById('modal').innerHTML=''; }
const ICON = {
  casa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  agenda:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  hist:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/></svg>',
  estrela:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  painel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/></svg>',
  balcao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h10"/></svg>',
  pessoas:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
  retorno:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4M6 22v-4h4"/></svg>',
  caixa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/></svg>',
  ajuste:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
};

/* ========= Estado de navegação ========= */
let modo = 'cliente', aba = 'inicio', clienteAtual = null;
let ag = {}; // rascunho do agendamento
function primeiroDiaLivre(dur=40){
  for(let i=0;i<D.config.diasAgenda;i++){
    const d = iso(addDias(HOJE,i));
    if(horariosDo(d).some(h=>livreCliente(d,h,dur))) return d;
  }
  return iso(addDias(HOJE,1));
}
/* Horários livres para o CLIENTE vêm do servidor (ele não vê a agenda dos outros).
   disp guarda a última consulta; quando muda o dia/serviço, busca de novo e redesenha. */
let disp = {};
function dispCliente(dur, ignorar, redesenhar){
  const chave = [dur, ignorar||'', ag.data||''].join('|');
  if(disp.chave === chave) return disp;
  if(disp.buscando === chave) return null;
  disp = {buscando:chave};
  (async()=>{
    try{
      const dias = await q(sb.rpc('dias_disponiveis', {p_dur:dur, p_ignorar:ignorar||null}));
      if(!ag.data || !dias.some(x=>x.data===ag.data && x.livre)) ag.data = (dias.find(x=>x.livre)||dias[0])?.data;
      const horas = ag.data ? await q(sb.rpc('horarios_livres', {p_data:ag.data, p_dur:dur, p_ignorar:ignorar||null})) : [];
      disp = {chave:[dur, ignorar||'', ag.data||''].join('|'), dias, horas:horas.map(h=>({...h, hora:hm(h.hora)}))};
      if(ag.hora && !disp.horas.some(h=>h.hora===ag.hora && h.livre)) ag.hora = null;
    }catch(e){ disp = {}; aviso(msgErro(e)); }
    (redesenhar||render)();
  })();
  return null;
}
const ABAS = {
  cliente:[['inicio','Início','casa'],['agendar','Agendar','agenda'],['historico','Histórico','hist'],['clube','Clube','estrela']],
  dono:[['hoje','Hoje','painel'],['agenda','Agenda','agenda'],['balcao','Balcão','balcao'],['caixa','Caixa','caixa'],['clientes','Clientes','pessoas'],['ajustes','Ajustes','ajuste']]
};
function irPara(a){ aba=a; render(); window.scrollTo({top:0}); }
function telaBloqueada(){
  const dono = perfil?.papel==='dono', l = licenca || {};
  return dono
    ? `<div class="painel" style="margin-top:30px;border-color:#8a2424"><h2 style="margin-top:0">Acesso suspenso</h2>
        <p class="sub">A mensalidade do sistema está em aberto${l.pago_ate?' desde '+fmtData(l.pago_ate):''}. Seus dados continuam guardados e o acesso volta assim que o pagamento for confirmado.</p>
        ${l.mensagem?`<p class="mudo pequeno">${esc(l.mensagem)}</p>`:''}
        ${l.contato?`<a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=${esc(soDig(l.contato))}&text=${encodeURIComponent('Olá! Quero regularizar a mensalidade do app da Vizzani.')}"><span>Falar com o suporte</span></a>`:''}
      </div>`
    : `<div class="painel" style="margin-top:30px"><h2 style="margin-top:0">App indisponível no momento</h2>
        <p class="sub">O agendamento pelo app está temporariamente fora do ar. Para agendar ou saber do seu carro, chame a Vizzani no WhatsApp.</p>
        <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=${D.loja.whatsapp}"><span>Falar no WhatsApp</span></a>
      </div>`;
}
/* ---- Tela "Licença": só o desenvolvedor (suporte) vê. Renovar, bloquear, desbloquear, ajustar ---- */
function telaLicenca(){
  const L = painelLic;
  if(!L) return `<div class="painel vazio" style="margin-top:30px">Carregando a licença… <button class="link" onclick="atualizarQuieto()">Atualizar</button></div>`;
  const nomes = {ativa:['Ativa','verde'], vencendo:['Vence em breve','amarelo'], atrasada:['Atrasada (na tolerância)','vermelho'], bloqueada:['Bloqueada','vermelho']};
  const [rot, cor] = nomes[L.status] || [L.status,''];
  const naoComecou = !L.pago_ate;
  const cobranca = `Olá, Vinícius! Tudo bem? A mensalidade do app da Vizzani ${L.pago_ate?(L.status==='ativa'||L.status==='vencendo'?'vence em '+fmtData(L.pago_ate):'venceu em '+fmtData(L.pago_ate)):'está disponível'}. Me avise quando fizer o Pix que eu libero na hora. Obrigado!`;
  return `<div style="margin-top:18px"><h1>Licença</h1><p class="sub">Mensalidade do sistema. Só você (suporte) vê esta tela.</p></div>
  <div class="painel" style="margin-top:16px;border-color:${cor==='verde'?'#1f7a50':cor==='amarelo'?'#8a6510':'#8a2424'}">
    <div class="linha entre"><b style="font-size:18px">Situação</b><span class="selo ${cor}">${rot}${L.em_teste&&!naoComecou?' · teste grátis':''}</span></div>
    ${naoComecou ? `<p class="sub">O teste grátis de ${L.dias_teste} dias ainda não começou. Ele começa sozinho no 1º login do dono da loja.</p>`
      : `<table class="tabela" style="margin-top:10px">
          <tr><td class="mudo">Início</td><td>${L.inicio?fmtData(L.inicio)+'/'+L.inicio.slice(0,4):'—'}</td></tr>
          <tr><td class="mudo">${L.em_teste?'Teste grátis até':'Pago até'}</td><td><b>${fmtData(L.pago_ate)}/${L.pago_ate.slice(0,4)}</b></td></tr>
          <tr><td class="mudo">Bloqueia em</td><td>${fmtData(L.suspende_em)}/${L.suspende_em.slice(0,4)} <span class="mudo">(${L.dias_tolerancia} dias de tolerância)</span></td></tr>
          ${L.bloqueado?'<tr><td class="mudo">Bloqueio manual</td><td><b class="sai">ligado</b></td></tr>':''}
        </table>`}
  </div>
  <div class="traco">RECEBI O PAGAMENTO</div>
  <div class="grade" style="grid-template-columns:1fr 1fr 1fr">
    ${[1,3,12].map(m=>`<button class="btn peq" onclick="renovarLicenca(${m})"><span>+${m} ${m===1?'mês':'meses'}</span></button>`).join('')}
  </div>
  <p class="mudo pequeno">Soma os meses a partir do vencimento atual (quem pagou atrasado não ganha dias). Também tira o bloqueio.</p>
  <div class="traco">BLOQUEIO</div>
  ${L.bloqueado || L.status==='bloqueada'
    ? `<button class="btn bloco zap" onclick="bloquearLicenca(false)"><span>Desbloquear agora</span></button><p class="mudo pequeno">${L.bloqueado?'Tira o bloqueio manual.':'Bloqueio por atraso: para liberar, registre o pagamento acima ou ajuste a data abaixo.'}</p>`
    : `<button class="btn bloco sec" style="border-color:#8a2424" onclick="bloquearLicenca(true)"><span>Bloquear agora</span></button><p class="mudo pequeno">Bloqueia na hora, sem esperar o vencimento. Os dados ficam guardados.</p>`}
  <a class="btn zap bloco" style="margin-top:10px;text-decoration:none" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=${D.loja.whatsapp}&text=${encodeURIComponent(cobranca)}"><span>Cobrar o Vinícius no WhatsApp</span></a>
  <div class="traco">AJUSTES</div><div class="painel">
    <label class="campo">Pago até (deixe vazio para o teste começar no 1º login do dono)<input type="date" id="lic-data" value="${L.pago_ate||''}"></label>
    <label class="campo">Dias de tolerância depois do vencimento<input type="number" id="lic-tol" min="0" max="60" value="${L.dias_tolerancia}"></label>
    <label class="campo">Seu WhatsApp de suporte<input id="lic-contato" inputmode="tel" value="${esc(L.contato_suporte||'')}"></label>
    <label class="campo">Recado para o dono (opcional)<input id="lic-msg" value="${esc(L.mensagem||'')}" placeholder="Ex.: Pix: suachave@email.com"></label>
    <button class="btn sec bloco" onclick="ajustarLicenca()"><span>Salvar ajustes</span></button>
  </div>
  ${modo==='dono'?`<button class="btn sec bloco" style="margin-top:14px" onclick="irPara('ajustes')"><span>Voltar para Ajustes</span></button>`:''}`;
}
function renovarLicenca(m){
  if(!confirm(`Confirmar pagamento de ${m} ${m===1?'mês':'meses'}?`)) return;
  return acao(()=>q(sb.rpc('licenca_renovar', {p_meses:m})), 'Licença renovada.');
}
function bloquearLicenca(b){
  if(b && !confirm('Bloquear o sistema agora? O dono e os clientes perdem o acesso até você desbloquear.')) return;
  return acao(()=>q(sb.rpc('licenca_bloquear', {p_bloquear:b})), b?'Sistema bloqueado.':'Sistema desbloqueado.');
}
function ajustarLicenca(){
  const data = document.getElementById('lic-data').value || null;
  return acao(()=>q(sb.rpc('licenca_ajustar', {p_pago_ate:data, p_tolerancia:Number(document.getElementById('lic-tol').value)||0,
    p_contato:document.getElementById('lic-contato').value, p_mensagem:document.getElementById('lic-msg').value})), 'Ajustes salvos.');
}
// Aviso para o dono nos dias antes de vencer e na tolerância
function avisoLicenca(){
  if(modo!=='dono' || !licenca || !['vencendo','atrasada'].includes(licenca.status)) return '';
  const atrasada = licenca.status==='atrasada';
  const oque = licenca.em_teste ? 'O período de teste grátis' : 'A mensalidade do sistema';
  return `<div class="${atrasada?'erro':'info'}" style="margin-top:12px">${atrasada
    ? `⚠ ${oque} ${licenca.em_teste?'terminou':'venceu'} em ${fmtData(licenca.pago_ate)}. O acesso será suspenso em ${fmtData(licenca.suspende_em)}.`
    : `${oque} ${licenca.em_teste?'termina':'vence'} em ${fmtData(licenca.pago_ate)}.`}
    ${licenca.mensagem?`<br>${esc(licenca.mensagem)}`:''}
    ${licenca.contato?` <a style="color:inherit;font-weight:700" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=${esc(soDig(licenca.contato))}">Falar com o suporte</a>`:''}</div>`;
}
function render(){
  if(!D) return;
  document.getElementById('btn-sair').hidden = !sessao;
  // Suporte (desenvolvedor): conta 'suporte' só vê a Licença; como dono, a Licença abre mesmo com o sistema bloqueado
  if(sessao && perfil && (modo==='suporte' || (suporte && licenca?.status==='bloqueada'))){
    document.querySelector('.nav').style.display='none';
    document.getElementById('tela').innerHTML = telaLicenca();
    return;
  }
  if(sessao && perfil && licenca?.status==='bloqueada'){
    document.querySelector('.nav').style.display='none';
    document.getElementById('tela').innerHTML = telaBloqueada();
    return;
  }
  const logado = !!sessao && (modo==='dono' || !!cliente(clienteAtual));
  if(!logado){
    document.querySelector('.nav').style.display='none';
    document.getElementById('tela').innerHTML = sessao && perfil ? `<div class="painel vazio" style="margin-top:30px">Esta conta ainda não está ligada a um cadastro de cliente. Fale com a Vizzani.<br><button class="btn sec" style="margin-top:12px" onclick="sair()"><span>Sair</span></button></div>` : telaEntrar();
    return;
  }
  document.querySelector('.nav').style.display='';
  document.getElementById('nav').innerHTML = ABAS[modo].map(([id,rot,ic])=>`<button class="${aba===id?'on':''}" onclick="irPara('${id}')" aria-current="${aba===id?'page':'false'}">${ICON[ic]}${rot}</button>`).join('');
  const f = {inicio:telaInicio,agendar:telaAgendar,historico:telaHistorico,clube:telaClube,hoje:telaHoje,agenda:telaAgendaDono,balcao:telaBalcao,caixa:telaCaixa,clientes:telaClientes,retorno:telaClientes,ajustes:telaAjustes,licenca:telaLicenca}[aba] || (modo==='dono'?telaHoje:telaInicio);
  document.getElementById('tela').innerHTML = avisoLicenca() + f();
}
/* ================= CLIENTE ================= */
function barraCliente(c){
  const pend = D.pendencias.filter(p=>p.clienteId===c.id);
  return `<div class="linha entre" style="margin-top:14px"><button class="link" onclick="abrirMeusDados()">Meus dados</button><button class="link" onclick="atualizarQuieto()">Atualizar</button></div>${botaoInstalar()}
  ${pend.map(p=>`<div class="info" style="margin-top:8px">A placa <b>${esc(p.placa)}</b> já estava cadastrada na Vizzani. A equipe vai confirmar e o carro aparece aqui em seguida.</div>`).join('')}
  ${D.recados.filter(r=>r.clienteId===c.id && !r.lido).map(r=>{
    const a = D.at.find(x=>x.id===r.atId), podeRemarcar = a && a.status==='agendado';
    return `<div class="recado"><b>📣 Recado da Vizzani</b><p style="margin:6px 0 10px">${esc(r.texto)}</p>
      <div class="acoes"><button class="btn peq" onclick="lerRecado('${r.id}')"><span>Ok, entendi</span></button>${podeRemarcar?`<button class="btn sec peq" onclick="lerRecado('${r.id}');remarcar('${a.id}')"><span>Não posso, remarcar</span></button>`:''}</div></div>`;
  }).join('')}`;
}
// Cartão do Clube no Início do cliente: mostra que ele é assinante, o que resta no mês e a mensalidade
function cartaoClubeCliente(mc){
  if(!mc) return '';
  if(mc.situacao==='pedido') return `<div class="info" style="margin-top:14px">⭐ Pedido do Clube enviado. A Vizzani ativa assim que receber a primeira mensalidade (${brl(mc.valor_mes)}).</div>`;
  if(!['em_dia','aberto'].includes(mc.situacao)) return '';
  const restam = Math.max(0, mc.limite_mes - mc.usadas_mes), mes = HOJE.toLocaleDateString('pt-BR',{month:'long'});
  const atrasado = mc.situacao==='aberto' && mc.dias_atraso>0;
  return `<div class="painel" style="margin-top:14px;border-color:#2a45b8;background:linear-gradient(135deg,#0c1850,#15171b 70%)">
    <div class="linha entre"><b style="font-size:17px">⭐ Você é do Clube Vizzani</b><span class="selo azul">${PORTES[mc.porte]||''}</span></div>
    <div class="linha entre" style="margin-top:10px"><span class="contador" style="font-size:36px">${restam}<small>de ${mc.limite_mes} ${restam===1?'lavagem disponível':'lavagens disponíveis'} em ${mes}</small></span></div>
    ${proximosMesesClube(clienteAtual)?`<p class="pequeno" style="margin:6px 0 0">📅 ${proximosMesesClube(clienteAtual)}</p>`:''}
    <p class="mudo pequeno" style="margin:6px 0 0">${esc(nomesNoClube())} · de segunda a sexta · sem sinal e sem pagar na hora. Cada lavagem conta no mês em que acontece.</p>
    ${atrasado
      ? `<div class="erro" style="margin:10px 0 0">A mensalidade venceu em ${fmtData(mc.proxima)}. Fale com a Vizzani para manter as lavagens incluídas.
          <a class="btn zap peq" style="text-decoration:none;margin-top:8px" target="_blank" rel="noopener" href="${linkZap(D.loja.whatsapp.replace(/^55/,''), 'Olá! Quero pagar a mensalidade do Clube Vizzani.')}"><span>Falar no WhatsApp</span></a></div>`
      : `<p class="pequeno" style="margin:8px 0 0">Próxima mensalidade: <b>${fmtData(mc.proxima)}</b> · ${brl(mc.valor_mes)}</p>`}
    ${restam>0?`<button class="btn bloco" style="margin-top:12px" onclick="irPara('agendar')"><span>Agendar lavagem do Clube</span></button>`:`<p class="mudo pequeno" style="margin:8px 0 0">Você já usou as lavagens do Clube deste mês. Outros serviços têm 10% de desconto.</p>`}
  </div>`;
}
function lerRecado(id){ return acao(()=>q(sb.rpc('marcar_recado_lido', {p_id:id}))); }
// Loja → cliente: recado que aparece no app do cliente (o dono grava direto; RLS permite)
const enviarRecado = (cid, atId, texto) => q(sb.from('recados').insert({cliente_id:cid, atendimento_id:atId||null, texto}));
function telaInicio(){
  const c = cliente(clienteAtual), vs = veiculosDe(c.id);
  const hojeAt = D.at.filter(a=>a.data===iso(HOJE) && vs.some(v=>v.placa===a.placa) && ['agendado','recebido','pronto'].includes(a.status));
  const proximos = D.at.filter(a=>a.data>iso(HOJE) && a.status==='agendado' && vs.some(v=>v.placa===a.placa)).sort((a,b)=>(a.data+a.hora).localeCompare(b.data+b.hora));
  const mc = D.meuClube, noClubeAtivo = mc && ['em_dia','aberto'].includes(mc.situacao);
  let h = barraCliente(c) + `<div class="linha entre" style="margin-top:18px"><h1>Olá, ${esc(c.nome.split(' ')[0])}</h1>${noClubeAtivo?'<span class="selo azul" style="font-size:13px">⭐ Clube</span>':''}</div>`
    + cartaoClubeCliente(mc);

  hojeAt.forEach(a=>{
    const passo = {agendado:1,recebido:2,pronto:3}[a.status];
    const txt = {agendado:`Esperamos seu carro às ${a.hora}.`,recebido:'Seu carro está com a gente, em atendimento.',pronto:'Pronto para retirada. Pode vir buscar!'}[a.status];
    h += `<div class="painel" style="margin-top:16px;border-color:${a.status==='pronto'?'#1f7a50':'#2a45b8'}">
      <div class="linha entre"><div><b>${esc(servico(a.servicoId).nome)} hoje</b>${a.clube?' <span class="selo azul">⭐ pelo Clube</span>':''}</div>${placaHTML(a.placa,true)}</div>
      <p class="sub">${txt}</p>
      <div class="etapas"><i class="etapa ${passo>=1?'feita':''}"></i><i class="etapa ${passo>=2?'feita':''}"></i><i class="etapa ${passo>=3?'pronta':''}"></i></div>
      <div class="etapas-rot"><span>Agendado</span><span style="text-align:center">Recebido</span><span style="text-align:right">Pronto</span></div>
      ${a.status==='agendado'?`${a.atraso?`<p class="mudo pequeno" style="margin:10px 0 0">Você avisou um atraso de ${a.atraso} min.</p>`:''}<div class="acoes"><button class="btn sec peq" onclick="avisarAtraso('${a.id}')"><span>Vou me atrasar</span></button><button class="btn sec peq" onclick="remarcar('${a.id}')"><span>Remarcar</span></button><button class="btn sec peq" onclick="cancelarAg('${a.id}')"><span>Cancelar</span></button></div>`:''}
    </div>`;
  });
  // avaliação do último serviço entregue (até 7 dias)
  const avaliar = D.at.filter(a=>a.status==='entregue' && donoAt(a)===c.id && !a.nota && diasEntre(a.data,iso(HOJE))<=7).sort((a,b)=>b.data.localeCompare(a.data))[0];
  if(avaliar) h += `<div class="painel" style="margin-top:16px"><b>Como ficou o ${esc(veiculo(avaliar.placa)?.modelo||'carro')}?</b><div class="mudo pequeno">${esc(servico(avaliar.servicoId).nome)} em ${fmtData(avaliar.data)}</div>
    <div class="estrelas">${[1,2,3,4,5].map(n=>`<button onclick="avaliar('${avaliar.id}',${n})" aria-label="${n} estrela${n>1?'s':''}">${'★'}</button>`).join('')}</div><div class="mudo pequeno">Toque nas estrelas: 1 = ruim, 5 = excelente.</div></div>`;

  h += `<div class="traco">MEUS VEÍCULOS</div>`;
  vs.forEach(v=>{
    const ult = ultimaLavagem(v.placa);
    const dias = ult ? diasEntre(ult.data, iso(HOJE)) : null;
    const garantia = garantiaChuva(v.placa);
    const atrasado = dias!==null && dias>=D.config.intervaloLavagem;
    h += `<div class="painel carro">
      <div>${placaHTML(v.placa)}<div class="mudo pequeno" style="margin-top:6px">${esc(v.modelo)} · ${PORTES[v.porte]}</div></div>
      <div style="text-align:right">${dias===null?'<span class="mudo">Sem lavagens ainda</span>':`<div class="contador">${dias}<small>dia${dias===1?'':'s'}</small></div><div class="mudo pequeno">desde a última lavagem</div>`}</div>
      ${garantia?`<div style="grid-column:1/-1"><span class="selo azul">☔ Garantia de chuva ativa até ${fmtData(iso(addDias(dataDe(garantia.data),D.config.chuvaHoras/24)))}</span><p class="mudo pequeno" style="margin:6px 0 0">Choveu? A relavagem é por nossa conta. É só passar aqui.</p></div>`:''}
      ${atrasado?`<div style="grid-column:1/-1"><span class="selo amarelo">Hora de lavar de novo</span></div>`:''}
    </div>`;
  });

  h += `<button class="btn sec bloco" style="margin-top:10px" onclick="abrirAddVeiculo()"><span>+ Adicionar veículo</span></button>`;
  if(proximos.length){
    h += `<div class="traco">PRÓXIMOS</div>`;
    proximos.forEach(a=> h+=`<div class="painel"${a.data===iso(addDias(HOJE,1))?' style="border-color:#2a45b8"':''}><div class="linha entre"><div>${a.data===iso(addDias(HOJE,1))?'<span class="selo azul">🔔 É amanhã</span><br>':''}<b>${esc(servico(a.servicoId).nome)}</b>${a.clube?' <span class="selo azul">⭐ pelo Clube</span>':''}<div class="mudo pequeno">${DIAS[dataDe(a.data).getDay()]}, ${fmtData(a.data)} às ${a.hora}</div></div>${placaHTML(a.placa,true)}</div>
      <div class="acoes"><button class="btn sec peq" onclick="remarcar('${a.id}')"><span>Remarcar</span></button><button class="btn sec peq" onclick="cancelarAg('${a.id}')"><span>Cancelar</span></button><button class="btn sec peq" onclick="baixarIcs('${a.id}')"><span>📅 Salvar na agenda</span></button></div></div>`);
  }
  const pts = pontosDe(c.id);
  h += `<div style="margin-top:20px"><button class="btn bloco" onclick="irPara('agendar')"><span>Agendar serviço</span></button></div>
    <div class="painel linha entre" style="margin-top:12px" onclick="irPara('clube')" role="button">
      <div><b>${pts} pontos</b>${noClubeAtivo?' <span class="selo azul">em dobro no Clube</span>':''}<div class="mudo pequeno">${pts>=D.config.pontosResgate?'Você já tem uma lavagem simples grátis':`Faltam ${D.config.pontosResgate-pts} para uma lavagem simples grátis`}</div></div>${ICON.estrela.replace('<svg','<svg width="26" height="26" style="color:var(--azul-claro)"')}
    </div>
    <div class="traco">A VIZZANI</div>
    <div class="painel">
      <b>${esc(D.loja.nome)}</b>
      <p class="mudo pequeno" style="margin:6px 0 0">📍 ${esc(D.loja.endereco)}</p>
      <p class="mudo pequeno" style="margin:4px 0 12px">🕒 ${esc(D.loja.horario)}</p>
      <div class="grade" style="grid-template-columns:1fr 1fr">
        <a class="btn zap peq" style="text-decoration:none" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=${D.loja.whatsapp}"><span>WhatsApp</span></a>
        <a class="btn sec peq" style="text-decoration:none" target="_blank" rel="noopener" href="${D.loja.mapa}"><span>Como chegar</span></a>
      </div>
    </div>`;
  return h;
}
/* ---- Cliente: cancelar, remarcar, atraso, avaliação ---- */
const descAt = a => `${servico(a.servicoId).nome}, ${DIAS[dataDe(a.data).getDay()]} ${fmtData(a.data)} às ${a.hora}`;
function cancelarAg(id){
  const a = D.at.find(x=>x.id===id), noPrazo = horasAte(a) >= D.config.prazoCancelar;
  abrirModal(`<h2 style="margin-top:0">Cancelar agendamento</h2><p class="sub">${esc(descAt(a))}</p>
    ${a.sinal?(noPrazo?`<div class="info" style="margin-top:12px">Você está cancelando com mais de ${D.config.prazoCancelar} h de antecedência. O sinal de ${brl(D.config.sinal)} é devolvido.</div>`:`<div class="erro" style="margin-top:12px">Faltam menos de ${D.config.prazoCancelar} h. Nesse caso o sinal de ${brl(D.config.sinal)} fica com a loja. Se puder, prefira remarcar falando com a Vizzani.</div>`):''}
    <label class="campo" style="margin-top:12px">Motivo (opcional)<input id="cx-motivo" placeholder="Ex.: surgiu um compromisso"></label>
    <button class="btn bloco" onclick="confirmarCancel('${id}')"><span>Cancelar agendamento</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
async function confirmarCancel(id){
  const motivo = document.getElementById('cx-motivo').value.trim();
  fecharModal();
  const r = await acao(()=>q(sb.rpc('cancelar', {p_id:id, p_motivo:motivo||null})));
  if(r!==false) aviso(r==='devolvido' ? 'Cancelado. A Vizzani vai devolver seu sinal.' : 'Agendamento cancelado. A Vizzani já foi avisada.');
}
function remarcar(id){
  const a = D.at.find(x=>x.id===id);
  if(horasAte(a) < D.config.prazoCancelar) return abrirModal(`<h2 style="margin-top:0">Remarcar</h2><p class="sub">Faltam menos de ${D.config.prazoCancelar} h para o horário. Fale direto com a Vizzani para remarcar.</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="https://api.whatsapp.com/send?phone=${D.loja.whatsapp}&text=${encodeURIComponent(`Olá! Preciso remarcar meu horário: ${descAt(a)} (${a.placa}).`)}"><span>Falar no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
  fecharModal(); ag = {remarcarId:id, placa:a.placa, servicoId:a.servicoId, data:null, hora:null}; disp = {}; aba='agendar'; render(); window.scrollTo({top:0});
}
async function confirmarRemarcacao(){
  fecharModal();
  const ok = await acao(()=>q(sb.rpc('remarcar', {p_id:ag.remarcarId, p_data:ag.data, p_hora:ag.hora})));
  disp = {};
  if(ok===false){ ag.hora = null; render(); return; }
  ag = {}; aviso('Horário remarcado. O sinal continua valendo.'); irPara('inicio');
}
function avisarAtraso(id){
  const a = D.at.find(x=>x.id===id);
  abrirModal(`<h2 style="margin-top:0">Vai se atrasar?</h2><p class="sub">Avisamos a equipe para segurar sua vaga.</p>
    <div class="grade" style="grid-template-columns:1fr 1fr 1fr;margin-top:14px">${[10,20,30].map(n=>`<button class="horario" onclick="registrarAtraso('${id}',${n})">${n} min</button>`).join('')}</div>
    <button class="btn sec bloco" style="margin-top:10px" onclick="remarcar('${id}')"><span>Não vou conseguir ir hoje</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
async function registrarAtraso(id,n){
  const a = D.at.find(x=>x.id===id), c = cliente(donoAt(a)), v = veiculo(a.placa);
  fecharModal();
  if(await acao(()=>q(sb.rpc('avisar_atraso', {p_id:id, p_min:n}))) === false) return;
  abrirModal(`<h2 style="margin-top:0">Atraso avisado ✅</h2><p class="sub">A equipe já vê o aviso no painel. Se quiser, mande também pelo WhatsApp.</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="https://api.whatsapp.com/send?phone=${D.loja.whatsapp}&text=${encodeURIComponent(`Olá! Aqui é ${c.nome}. Vou atrasar uns ${n} minutos para o horário das ${a.hora} (${v.modelo}, ${a.placa}).`)}"><span>Enviar no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}
async function avaliar(id,n){
  if(n<=3) return abrirModal(`<h2 style="margin-top:0">O que podemos melhorar?</h2><p class="sub">Sua resposta vai direto para o Vinícius, não é publicada.</p>
    <textarea class="obs" id="av-txt" style="margin-top:12px" placeholder="Conte o que aconteceu (opcional)"></textarea>
    <button class="btn bloco" style="margin-top:12px" onclick="enviarAvaliacao('${id}',${n})"><span>Enviar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
  if(await acao(()=>q(sb.rpc('avaliar', {p_id:id, p_nota:n, p_comentario:null}))) === false) return;
  return abrirModal(`<h2 style="margin-top:0">Obrigado! ${'★'.repeat(n)}</h2><p class="sub">Que bom que gostou. Uma avaliação no Google ajuda muito a Vizzani a ser encontrada.</p>
    <a class="btn bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="${D.loja.mapa}"><span>Avaliar no Google</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Agora não</span></button>`);
}
async function enviarAvaliacao(id,n){
  const t = document.getElementById('av-txt').value.trim();
  fecharModal();
  await acao(()=>q(sb.rpc('avaliar', {p_id:id, p_nota:n, p_comentario:t||null})), 'Obrigado pelo retorno.');
}
function baixarIcs(id){
  const a = D.at.find(x=>x.id===id), d = a.data.replace(/-/g,''), ini = a.hora.replace(':','')+'00', fim = hhmm(Math.min(mins(a.hora)+servico(a.servicoId).dur, 23*60+59)).replace(':','')+'00';
  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Vizzani//App//PT','BEGIN:VEVENT','UID:'+a.id+'@vizzani.app','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z',
    'DTSTART;TZID=America/Sao_Paulo:'+d+'T'+ini,'DTEND;TZID=America/Sao_Paulo:'+d+'T'+fim,'SUMMARY:'+servico(a.servicoId).nome+' - Vizzani','LOCATION:'+D.loja.endereco.replace(/,/g,'\\,'),
    'BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY','DESCRIPTION:Lembrete Vizzani','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
  baixar('vizzani-'+a.data+'.ics', ics, 'text/calendar');
}
function baixar(nome, conteudo, tipo){
  const url = URL.createObjectURL(new Blob([conteudo],{type:tipo})), el = document.createElement('a');
  el.href=url; el.download=nome; document.body.appendChild(el); el.click(); el.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function telaAgendar(){
  const c = cliente(clienteAtual), vs = veiculosDe(c.id);
  if(!vs.length) return `<div style="margin-top:18px"><h1>Agendar</h1></div><div class="painel vazio" style="margin-top:16px">Você ainda não tem veículo confirmado.<br><button class="btn" style="margin-top:12px" onclick="abrirAddVeiculo()"><span>Adicionar veículo</span></button></div>`;
  if(!ag.placa || !vs.some(x=>x.placa===ag.placa)) ag.placa = vs[0]?.placa;
  if(ag.servicoId && servico(ag.servicoId).precos[veiculo(ag.placa).porte]==null) ag.servicoId=null;
  const dur = ag.servicoId ? servico(ag.servicoId).dur : 40;
  const v = veiculo(ag.placa);
  const clube = noClube(c.id), usos = usoClubeMes(c.id);
  const rem = ag.remarcarId && D.at.find(x=>x.id===ag.remarcarId);
  if(rem){
    let h = `<div style="margin-top:18px"><h1>Remarcar</h1><p class="sub">Escolha o novo dia e horário. O sinal já pago continua valendo.</p></div>
      <div class="painel linha entre" style="margin-top:14px"><div><b>${esc(servico(rem.servicoId).nome)}</b><div class="mudo pequeno">Hoje marcado: ${DIAS[dataDe(rem.data).getDay()]} ${fmtData(rem.data)} às ${rem.hora}</div></div>${placaHTML(rem.placa,true)}</div>`
      + seletorDiaHora(dur, rem.id)
      + `<div style="margin-top:18px"><button class="btn bloco" ${ag.data&&ag.hora?'':'disabled'} onclick="revisarRemarcacao()"><span>Confirmar novo horário</span></button>
      <button class="btn sec bloco" style="margin-top:8px" onclick="ag={};irPara('inicio')"><span>Desistir de remarcar</span></button></div>`;
    return h;
  }
  let h = `<div style="margin-top:18px"><h1>Agendar</h1><p class="sub">Escolha o carro, o serviço e o horário.</p></div>`;
  if(vs.length>1){
    h += `<div class="traco">VEÍCULO</div><div class="chips">${vs.map(x=>`<button class="chip ${x.placa===ag.placa?'on':''}" onclick="ag.placa='${x.placa}';render()">${placaHTML(x.placa,true)}<span class="pequeno" style="display:block;margin-top:4px">${esc(x.modelo)}</span></button>`).join('')}</div>`;
  }
  h += `<div class="traco">SERVIÇO</div><p class="mudo pequeno" style="margin-top:-4px">Preços para ${PORTES[v.porte]} (${esc(v.modelo)}).</p>`;
  D.servicos.filter(s=>s.precos[v.porte]!=null).forEach(s=>{
    const cobreClube = clube && s.noClube && usos < D.config.clubeLavagens;
    h += `<button class="servico ${ag.servicoId===s.id?'on':''}" onclick="ag.servicoId='${s.id}';render()">
      <span><b>${esc(s.nome)}</b>${s.destaque?` <span class="selo azul">${s.destaque}</span>`:''}<span class="mudo pequeno" style="display:block">${esc(s.inclui)}</span><span class="mudo pequeno" style="display:block">cerca de ${durTxt(s.dur)}</span></span>
      <span style="text-align:right;flex:none">${s.apartir?'<span class="mudo pequeno" style="display:block">a partir de</span>':''}<span class="valor">${brl(s.precos[v.porte])}</span>${cobreClube?'<span class="selo azul" style="display:block;margin-top:4px">Incluso no Clube*</span>':''}</span></button>`;
  });
  h += seletorDiaHora(dur);
  if(clube) h += `<p class="mudo pequeno">*Clube: ${D.config.clubeLavagens-usos} de ${D.config.clubeLavagens} lavagens restantes neste mês, válidas de segunda a sexta.</p>`;
  const pronto = ag.placa && ag.servicoId && ag.data && ag.hora;
  h += `<div style="margin-top:18px"><button class="btn bloco" ${pronto?'':'disabled'} onclick="revisarAg()"><span>Revisar agendamento</span></button></div>`;
  return h;
}
// Dias e horários livres, respeitando expediente, bloqueios, antecedência e a duração do serviço
function seletorDiaHora(dur, ignorar, dono=false){
  if(!dono) return seletorCliente(dur, ignorar);
  const livre =(d,hr) => dono ? !jaPassou(d,hr) && cabe(d,hr,dur,ignorar) : livreCliente(d,hr,dur,ignorar);
  let h = `<div class="traco">DIA</div><div class="chips">`;
  for(let i=0;i<D.config.diasAgenda;i++){
    const d = iso(addDias(HOJE,i)), dow = dataDe(d).getDay(), hs = horariosDo(d);
    const tem = hs.some(hr=>livre(d,hr));
    h += `<button class="chip ${d===ag.data?'on':''}" ${tem?'':'disabled'} onclick="ag.data='${d}';ag.hora=null;render()">${i===0?'hoje':DIAS[dow]}<b>${dataDe(d).getDate()}</b></button>`;
  }
  h += `</div><div class="traco">HORÁRIO</div>`;
  const hs = horariosDo(ag.data);
  if(!hs.length){ const b = D.bloqueios.find(x=>x.data===ag.data); return h + `<div class="painel vazio">${b?'Fechado neste dia: '+esc(b.motivo):'A Vizzani não abre neste dia.'}</div>`; }
  h += `<div class="grade">` + hs.map(hr=>{
    const livres = D.config.capacidade - ocupacao(ag.data,hr,ignorar), passou = jaPassou(ag.data,hr,dono?0:D.config.antecedencia), ok = livre(ag.data,hr);
    return `<button class="horario ${ag.hora===hr?'on':''}" ${ok?'':'disabled'} onclick="ag.hora='${hr}';render()">${hr}<small>${passou?'—':!ok&&livres>0?'sem tempo':livres>0?livres+' vaga'+(livres>1?'s':''):'lotado'}</small></button>`;
  }).join('') + `</div>`;
  if(dur>=240) h += `<p class="mudo pequeno">Serviço longo (${durTxt(dur)}): só aparecem horários em que há vaga pelo tempo todo. Se passar do fechamento, o carro fica para o dia seguinte.</p>`;
  return h;
}
// Cliente: dias e horários calculados no servidor (horarios_livres / dias_disponiveis)
function seletorCliente(dur, ignorar){
  const d = dispCliente(dur, ignorar);
  if(!d) return `<div class="traco">DIA</div><div class="painel vazio">Buscando horários livres…</div>`;
  let h = `<div class="traco">DIA</div><div class="chips">` + d.dias.map(x=>{
    const dow = dataDe(x.data).getDay();
    return `<button class="chip ${x.data===ag.data?'on':''}" ${x.livre?'':'disabled'} onclick="ag.data='${x.data}';ag.hora=null;render()">${x.data===iso(HOJE)?'hoje':DIAS[dow]}<b>${dataDe(x.data).getDate()}</b></button>`;
  }).join('') + `</div><div class="traco">HORÁRIO</div>`;
  if(!d.horas.length){ const b = D.bloqueios.find(x=>x.data===ag.data && x.diaTodo); return h + `<div class="painel vazio">${b?'Fechado neste dia: '+esc(b.motivo):'A Vizzani não abre neste dia.'}</div>`; }
  h += `<div class="grade">` + d.horas.map(x=>`<button class="horario ${ag.hora===x.hora?'on':''}" ${x.livre?'':'disabled'} onclick="ag.hora='${x.hora}';render()">${x.hora}<small>${x.passou?'—':!x.livre&&x.vagas>0?'sem tempo':x.vagas>0?x.vagas+' vaga'+(x.vagas>1?'s':''):'lotado'}</small></button>`).join('') + `</div>`;
  if(dur>=240) h += `<p class="mudo pequeno">Serviço longo (${durTxt(dur)}): só aparecem horários em que há vaga pelo tempo todo. Se passar do fechamento, o carro fica para o dia seguinte.</p>`;
  return h;
}
function revisarRemarcacao(){
  abrirModal(`<h2 style="margin-top:0">Confirmar novo horário</h2><p class="sub">${DIAS[dataDe(ag.data).getDay()]}, ${fmtData(ag.data)} às ${ag.hora}</p>
    <button class="btn bloco" style="margin-top:14px" onclick="confirmarRemarcacao()"><span>Confirmar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function revisarAg(){
  const c = cliente(clienteAtual), v = veiculo(ag.placa), s = servico(ag.servicoId);
  const dow = dataDe(ag.data).getDay();
  const usaClube = clubeElegivel(c.id, s.id, ag.data).ok;
  const valor = usaClube ? 0 : s.precos[v.porte];
  ag.usaClube = usaClube;
  abrirModal(`<h2 style="margin-top:0">Confirme</h2>
    <div class="linha entre">${placaHTML(v.placa)}<div style="text-align:right"><b>${esc(s.nome)}</b><div class="mudo pequeno">${DIAS[dow]}, ${fmtData(ag.data)} às ${ag.hora}</div></div></div>
    <div class="linha entre" style="margin-top:14px"><span class="mudo">Valor</span><span class="valor">${usaClube?'Incluso no Clube':(s.apartir?'a partir de ':'')+brl(valor)}</span></div>${s.apartir&&!usaClube?'<p class="mudo pequeno">O valor final é confirmado na avaliação do veículo.</p>':''}
    ${usaClube?`<p class="mudo pequeno">Sem sinal para membros do Clube.</p><button class="btn bloco" style="margin-top:12px" onclick="confirmarAg(false)"><span>Confirmar agendamento</span></button>`:
    `<div class="pix"><b>Sinal de ${brl(D.config.sinal)} via Pix</b>
      ${D.loja.pix?`<div style="margin:8px 0 4px;font-size:13px">Chave Pix:</div><div style="font-weight:700;word-break:break-all">${esc(D.loja.pix)}</div><button class="btn sec peq" style="margin-top:8px;color:#fff" onclick="copiarPix()"><span>Copiar chave</span></button>`:`<div style="font-size:13px;margin-top:6px">Peça a chave Pix no WhatsApp da Vizzani.</div>`}
      <div style="font-size:13px;margin-top:8px">Garante sua vaga e é descontado do valor final. Devolvido se você cancelar com até ${D.config.prazoCancelar} h de antecedência.</div></div>
    <button class="btn bloco" onclick="confirmarAg(true)"><span>Já paguei o sinal</span></button>`}
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function copiarPix(){ try{ navigator.clipboard.writeText(D.loja.pix).then(()=>aviso('Chave Pix copiada.')); }catch(e){ aviso(D.loja.pix); } }
async function confirmarAg(sinal){
  fecharModal();
  const id = await acao(()=>q(sb.rpc('agendar', {p_placa:ag.placa, p_servico:ag.servicoId, p_data:ag.data, p_hora:ag.hora, p_sinal_pago:!!sinal})));
  disp = {};
  if(id===false){ ag.hora = null; render(); return; }
  ag = {}; irPara('inicio'); modalLembretes(id);
}

function telaHistorico(){
  const vs = veiculosDe(clienteAtual);
  let h = `<div style="margin-top:18px"><h1>Histórico</h1><p class="sub">Tudo o que já fizemos no seu carro.</p></div>`;
  vs.forEach(v=>{
    const lista = entreguesDe(v.placa).filter(a=>donoAt(a)===clienteAtual);
    const total = lista.reduce((s,a)=>s+a.valor,0);
    h += `<div class="traco">${esc(v.modelo.toUpperCase())}</div><div class="painel"><div class="linha entre">${placaHTML(v.placa,true)}<span class="mudo pequeno">${lista.length} serviço${lista.length===1?'':'s'} · ${brl(total)}</span></div>`;
    if(!lista.length) h += `<div class="vazio">Nenhum serviço ainda. O primeiro fica registrado aqui.</div>`;
    lista.forEach(a=>{
      h += `<div class="fila" style="grid-template-columns:52px 1fr auto"><span class="hora">${fmtData(a.data)}</span><span>${esc(servico(a.servicoId).nome)}${a.chuva?' <span class="selo azul">relavagem de chuva</span>':''}${a.clube?' <span class="selo">Clube</span>':''}${a.depois?.fotos?.length?` <span class="selo link" onclick="verFotos('${a.id}')">📷 antes e depois</span>`:a.vistoria?.fotos?.length?` <span class="selo link" onclick="verVistoria('${a.id}')">📷 fotos da entrada</span>`:''}</span><b>${a.valor?brl(a.valor):'—'}</b></div>`;
    });
    // recomendações baseadas no histórico real
    const rec = [];
    const ultHig = lista.find(a=>a.servicoId==='higien'), ultPol = lista.find(a=>a.servicoId==='polimento');
    if(!ultHig || diasEntre(ultHig.data,iso(HOJE))>180) rec.push(ultHig?`Última higienização há ${Math.round(diasEntre(ultHig.data,iso(HOJE))/30)} meses.`:'Seu carro ainda não teve higienização interna com a gente.');
    if(ultPol && diasEntre(ultPol.data,iso(HOJE))>120) rec.push(`Polimento feito há ${Math.round(diasEntre(ultPol.data,iso(HOJE))/30)} meses. Uma vitrificação ajuda a manter o brilho.`);
    if(rec.length) h += `<div style="margin-top:10px">${rec.map(r=>`<p class="mudo pequeno" style="margin:4px 0">💡 ${r}</p>`).join('')}</div>`;
    h += `</div>`;
  });
  return h;
}

function telaClube(){
  const c = cliente(clienteAtual), pts = pontosDe(c.id), meta = D.config.pontosResgate;
  const pct = Math.min(100, pts % meta / meta * 100 + (pts>=meta?0:0));
  const lavagensGratis = Math.floor(pts/meta);
  const porteBase = veiculosDe(c.id).map(v=>v.porte).find(p=>p!=='moto') || 'moto';
  let h = `<div style="margin-top:18px"><h1>Vizzani Club</h1><p class="sub">Cada R$ 1 gasto vira 1 ponto.</p></div>
  <div class="painel" style="margin-top:16px">
    <div class="linha entre"><span class="contador">${pts}<small>pontos</small></span>${lavagensGratis?`<span class="selo verde">${lavagensGratis} lavagem grátis</span>`:''}</div>
    <div class="barra"><i style="width:${pts>=meta?100:pct}%"></i></div>
    <div class="mudo pequeno">${pts>=meta?'Mostre esta tela no balcão para usar sua lavagem simples grátis.':`Faltam ${meta-pts} pontos para uma lavagem simples grátis.`}</div>
  </div>`;
  if(noClube(c.id)){
    const usos = usoClubeMes(c.id);
    h += `<div class="traco">SUA ASSINATURA</div><div class="painel" style="border-color:#2a45b8">
      <div class="linha entre"><b>Plano mensal ativo</b><span class="selo azul">desde ${fmtData(D.clube[c.id].desde)}</span></div>
      <p class="sub">${Math.max(0,D.config.clubeLavagens-usos)} de ${D.config.clubeLavagens} lavagens disponíveis este mês.</p>
      <div class="barra"><i style="width:${Math.min(100,usos/D.config.clubeLavagens*100)}%"></i></div>
      ${proximosMesesClube(c.id)?`<p class="pequeno">📅 ${proximosMesesClube(c.id)}</p>`:''}
      <p class="mudo pequeno">Incluso: ${esc(nomesNoClube())}, de segunda a sexta, sem sinal. Nos outros serviços: 10% de desconto e pontos em dobro.</p>
      ${D.meuClube?.proxima?`<p class="pequeno">${D.meuClube.situacao==='aberto'&&D.meuClube.dias_atraso>0?`<span class="sai">Mensalidade em aberto desde ${fmtData(D.meuClube.proxima)}.</span>`:`Próxima mensalidade: <b>${fmtData(D.meuClube.proxima)}</b> · ${brl(D.meuClube.valor_mes)}`}</p>`:''}
      <button class="link" onclick="cancelarClube()">Cancelar assinatura</button>
    </div>`;
  } else {
    h += `<div class="traco">PLANO MENSAL</div><div class="painel" style="border-color:#2a45b8;background:linear-gradient(135deg,#0c1850,#15171b 70%)">
      <div class="linha entre"><b style="font-size:18px">Clube Vizzani</b><span class="valor">${brl(D.config.clubePrecos[porteBase])}<span class="mudo pequeno">/mês</span></span></div>
      <p class="sub" style="color:var(--prata)">${D.config.clubeLavagens} lavagens por mês (${esc(nomesNoClube())}, de seg. a sex.), 10% de desconto nos outros serviços, pontos em dobro e sem sinal no agendamento.</p>
      <p class="mudo pequeno">${porteBase==='moto'?'':`Avulso, 2 lavagens completas saem por ${brl(servico('completa').precos[porteBase]*2)}. No Clube, você economiza ${brl(servico('completa').precos[porteBase]*2-D.config.clubePrecos[porteBase])} por mês.`} Valor para ${PORTES[porteBase]}.</p>
      ${D.clube[c.id]?.pendente
        ? `<div class="info" style="margin-top:12px">Pedido enviado ✅ A Vizzani ativa sua assinatura assim que receber a primeira mensalidade (no balcão ou por Pix).</div>`
        : `<button class="btn bloco" style="margin-top:12px" onclick="assinar()"><span>Quero assinar o Clube</span></button>`}
    </div>`;
  }
  h += `<div class="traco">CONVIDE UM AMIGO</div><div class="painel">
    <p style="margin:0 0 10px">Gostou do serviço? Mande o app para um amigo.</p>
    <a class="btn zap bloco" style="text-decoration:none" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?text=${encodeURIComponent('Lavo meu carro na Vizzani Estética, em Uberlândia. Dá para agendar pelo app: '+location.origin+location.pathname)}"><span>Enviar convite pelo WhatsApp</span></a>
  </div>`;
  return h;
}
function assinar(){ return acao(()=>q(sb.rpc('pedir_clube')), 'Pedido enviado! A Vizzani vai confirmar.'); }
function cancelarClube(){
  if(!confirm('Cancelar a assinatura do Clube? Não haverá nova cobrança e as lavagens incluídas deixam de valer.')) return;
  return acao(()=>q(sb.rpc('cancelar_clube')), 'Assinatura cancelada.');
}
/* ================= DONO ================= */
function telaHoje(){
  const hoje = iso(HOJE);
  const lista = D.at.filter(a=>a.data===hoje && !['cancelado'].includes(a.status)).sort((a,b)=>a.hora.localeCompare(b.hora));
  const ativos = lista.filter(a=>a.status!=='faltou');
  const previsto = ativos.reduce((s,a)=>s+a.valor,0);
  const recebido = lista.filter(a=>a.pago).reduce((s,a)=>s+a.valor,0);
  const n = st => lista.filter(a=>a.status===st).length;
  const d = HOJE.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
  const semRetorno = clientesSumidos().filter(x=>x.dias>=30).length;
  let h = `<div style="margin-top:18px"><h1>Hoje</h1><p class="sub">${d.charAt(0).toUpperCase()+d.slice(1)}</p></div>
  <div class="kpis" style="margin-top:16px">
    <div class="kpi destaque"><b>${brl(previsto)}</b><span>previstos hoje · ${brl(recebido)} já recebidos</span></div>
    <div class="kpi"><b>${ativos.length}</b><span>carros na agenda</span></div>
    <div class="kpi"><b>${n('recebido')}</b><span>em atendimento</span></div>
    <div class="kpi"><b>${n('pronto')}</b><span>prontos p/ retirada</span></div>
    <div class="kpi" onclick="subCli='retorno';irPara('clientes')" role="button" style="border-color:${semRetorno?'#8a6510':'var(--linha)'}"><b>${semRetorno}</b><span>clientes sumidos (30+ dias)</span></div>
  </div>
  ${D.pendencias.length?`<div class="info" style="margin-top:12px;cursor:pointer" onclick="irPara('balcao')">📝 ${D.pendencias.length} cadastro${D.pendencias.length>1?'s':''} de cliente para confirmar no Balcão.</div>`:''}
  ${clubeAtencao()?`<div class="info" style="margin-top:12px;cursor:pointer" onclick="subCli='clube';irPara('clientes')">⭐ ${clubeAtencao()} assinatura${clubeAtencao()>1?'s':''} do Clube precisa${clubeAtencao()>1?'m':''} de atenção (pedido para ativar ou mensalidade atrasada).</div>`:''}
  ${alertaEstoque()}
  ${painelNotifs()}
  ${painelLembretes()}
  <div class="traco">FILA DO DIA</div><div class="painel">`;
  if(!lista.length) h += `<div class="vazio">Nenhum carro agendado hoje. Use o Balcão para registrar quem chegar.</div>`;
  lista.forEach(a=>{
    const v = veiculo(a.placa), c = donoDe(a.placa), s = servico(a.servicoId);
    const selo = {agendado:a.sinal?'<span class="selo">Sinal pago</span>':'<span class="selo amarelo">Sem sinal</span>',recebido:'<span class="selo azul">Em atendimento</span>',pronto:'<span class="selo verde">Pronto</span>',entregue:'<span class="selo verde">Entregue</span>',faltou:'<span class="selo vermelho">Não veio</span>'}[a.status];
    let acao = '';
    if(a.status==='agendado') acao = `<button class="btn peq" onclick="mudar('${a.id}','recebido')"><span>Receber</span></button>`;
    if(a.status==='recebido') acao = `<button class="btn peq" onclick="mudar('${a.id}','pronto')"><span>Pronto</span></button>`;
    if(a.status==='pronto') acao = `<button class="btn peq zap" onclick="entregar('${a.id}')"><span>Entregar</span></button>`;
    h += `<div class="fila"><span class="hora">${a.hora}</span>
      <div>${placaHTML(a.placa,true)}<div class="pequeno" style="margin-top:4px"><b>${esc(s.nome)}</b> · ${esc(v.modelo)}</div><div class="mudo pequeno">${esc(c.nome)} · ${a.valor?brl(a.valor):(a.chuva?'relavagem de chuva':'Clube')} ${selo}</div>${a.atraso&&a.status==='agendado'?`<span class="selo amarelo" style="margin-top:4px">⏱ vai atrasar ${a.atraso} min</span> `:''}${a.remarcadoDe?`<span class="selo" style="margin-top:4px">remarcado (era ${esc(a.remarcadoDe)})</span> `:''}${seloVistoria(a)}${a.depois?.fotos?.length?` <span class="selo link" style="margin-top:4px" onclick="verFotos('${a.id}')">📷 depois</span>`:''}${a.lembrete&&a.status==='agendado'?` <span class="selo" style="margin-top:4px">${a.confirmado?'✅ confirmou':'🔔 lembrado'}</span>`:''}</div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">${acao}${a.status==='agendado'?`<button class="btn sec peq" onclick="acoesAt('${a.id}')"><span>Mais</span></button>`:''}</div>
    </div>`;
  });
  h += `</div>`;
  const faltas = D.at.filter(a=>a.status==='faltou').length, total = D.at.filter(a=>a.status!=='cancelado' && a.data<=hoje).length;
  if(faltas) h += `<p class="mudo pequeno">Faltas registradas: ${faltas} de ${total} agendamentos. O sinal via Pix existe para reduzir esse número.</p>`;
  return h;
}
async function mudar(id,st){
  if(st==='recebido'){ abrirVistoria(id); return; }
  const a = D.at.find(x=>x.id===id), campos = {status:st};
  if(st==='faltou' && a.sinal) campos.sinal_status = 'retido';
  const ok = await acao(()=>q(sb.from('atendimentos').update(campos).eq('id',id)), st==='faltou'?'Registrado como falta.':null);
  if(ok===false) return;
  if(st==='pronto') return D.config.fotosDepois ? abrirDepois(id) : avisarPronto(id);
}
/* ---- Fotos no Storage privado: {atendimento}/{antes|depois}/{uuid}.jpg ---- */
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
async function enviarFotos(atId, momento, dataUrls){
  const linhas = [];
  for(const u of dataUrls){
    const blob = await (await fetch(u)).blob();
    const caminho = `${atId}/${momento}/${novoId()}.jpg`;
    const { error } = await sb.storage.from('vistorias').upload(caminho, blob, {contentType:'image/jpeg', upsert:false});
    if(error) throw error;
    linhas.push({atendimento_id:atId, momento, caminho});
  }
  if(linhas.length) await q(sb.from('fotos').insert(linhas));
}
// Links temporários (1 h) para mostrar fotos do bucket privado
async function urlsFotos(lista){
  if(!lista?.length) return [];
  const { data, error } = await sb.storage.from('vistorias').createSignedUrls(lista.map(f=>f.caminho), 3600);
  if(error) throw error;
  return data.map(d=>d.signedUrl).filter(Boolean);
}
function avisarPronto(id){
  const a = D.at.find(x=>x.id===id), c = donoDe(a.placa), v = veiculo(a.placa), fotos = a.depois?.fotos.length;
  abrirModal(`<h2 style="margin-top:0">Avisar o cliente</h2><p class="sub">${esc(c.nome)} recebe no WhatsApp que o ${esc(v.modelo)} está pronto.</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="${linkZap(c.fone,`Olá, ${c.nome.split(' ')[0]}! Seu ${v.modelo} (${a.placa}) está pronto para retirada na Vizzani Estética. 🚗✨${fotos?' As fotos do antes e depois já estão no app.':''}`)}"><span>Enviar no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Agora não</span></button>`);
}
/* Fotos do depois: opcionais, com carimbo, aparecem para o cliente ao lado das fotos da entrada */
let depois = null;
function abrirDepois(id){ depois = {id, fotos:[]}; desenharDepois(); }
function desenharDepois(){
  const a = D.at.find(x=>x.id===depois.id), v = veiculo(a.placa);
  abrirModal(`<h2 style="margin-top:0">Fotos do depois <span class="selo">opcional</span></h2>
    <div class="linha entre">${placaHTML(v.placa)}<b>${esc(servico(a.servicoId).nome)}</b></div>
    <p class="mudo pequeno" style="margin:12px 0 8px">Tire do mesmo ângulo das fotos da entrada. O cliente vê o antes e depois no app.</p>
    <label class="camera">📷 Tirar fotos do depois<small>${depois.fotos.length?depois.fotos.length+' foto'+(depois.fotos.length>1?'s':'')+' · toque para adicionar mais':'câmera ou galeria'}</small>
      <input type="file" accept="image/*" capture="environment" multiple onchange="addFotosDepois(this.files)"></label>
    ${depois.fotos.length?`<div class="fotos">${depois.fotos.map((f,i)=>`<button onclick="depois.fotos.splice(${i},1);desenharDepois()" aria-label="Remover foto ${i+1}"><img src="${f}" alt="Foto ${i+1}"><span class="x">×</span></button>`).join('')}</div>`:''}
    <button class="btn bloco" style="margin-top:12px" ${depois.fotos.length?'':'disabled'} onclick="salvarDepois()"><span>Salvar fotos e avisar o cliente</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="const id=depois.id;depois=null;avisarPronto(id)"><span>Pular fotos</span></button>`);
}
async function addFotosDepois(files){
  const a = D.at.find(x=>x.id===depois.id); aviso('Processando fotos...');
  for(const f of files){ try{ depois.fotos.push(await carimbar(f, a.placa, 'DEPOIS')); }catch(e){ aviso('Não consegui ler uma das fotos.'); } }
  desenharDepois();
}
async function salvarDepois(){
  const id = depois.id, fotos = depois.fotos;
  abrirModal(`<div class="vazio">Enviando ${fotos.length} foto${fotos.length>1?'s':''}…</div>`);
  const ok = await acao(()=>enviarFotos(id, 'depois', fotos));
  if(ok===false){ desenharDepois(); return; }
  depois = null; avisarPronto(id);
}
async function verFotos(id){
  const a = D.at.find(x=>x.id===id);
  abrirModal(`<div class="vazio">Carregando fotos…</div>`);
  let antes = [], dep = [];
  try{ [antes, dep] = await Promise.all([urlsFotos(a.vistoria?.fotos), urlsFotos(a.depois?.fotos)]); }catch(e){ aviso(msgErro(e)); }
  abrirModal(`<h2 style="margin-top:0">Antes e depois</h2><div class="linha entre">${placaHTML(a.placa,true)}<span class="mudo pequeno">${esc(servico(a.servicoId).nome)} · ${fmtData(a.data)}</span></div>
    ${antes.length?`<div class="traco">ANTES</div>${antes.map(f=>`<img class="foto-grande" src="${esc(f)}" alt="Foto da entrada">`).join('')}`:''}
    ${dep.length?`<div class="traco">DEPOIS</div>${dep.map(f=>`<img class="foto-grande" src="${esc(f)}" alt="Foto do depois">`).join('')}`:''}
    ${!antes.length&&!dep.length?'<div class="vazio">As fotos já foram apagadas (ficam guardadas por '+D.config.fotosDias+' dias).</div>':`<p class="mudo pequeno">Para salvar no celular, toque e segure a foto. Elas ficam no app por ${D.config.fotosDias} dias.</p>`}
    <button class="btn sec bloco" onclick="fecharModal()"><span>Fechar</span></button>`);
}
/* Entrega: valor final ajustável ("a partir de"), extras, desconto do Clube e resgate de pontos */
let entrega = null;
function entregar(id){
  const a = D.at.find(x=>x.id===id), s = servico(a.servicoId), cid = donoAt(a);
  const gratis = a.clube || a.chuva;                     // lavagem do Clube ou relavagem de chuva: não se cobra o serviço
  const descClube = !gratis && noClube(cid) && !s.noClube && a.valor>0 ? 10 : 0;   // 10% nos serviços fora do Clube
  entrega = {id, valor:gratis?0:a.valor, extra:0, extraDesc:'', desconto:descClube, resgate:false, gratis};
  desenharEntrega();
}
function totalEntrega(){
  const e = entrega, a = D.at.find(x=>x.id===e.id);
  if(e.resgate) return 0;
  return Math.max(0, Math.round(((Number(e.valor)||0) + (Number(e.extra)||0)) * (1 - e.desconto/100) * 100)/100);
}
function desenharEntrega(){
  const e = entrega, a = D.at.find(x=>x.id===e.id), s = servico(a.servicoId), cid = donoAt(a);
  const sinal = a.sinal?D.config.sinal:0, total = totalEntrega(), falta = Math.max(0,total-sinal);
  const podeResgatar = !e.gratis && s.id==='simples' && pontosDe(cid) >= D.config.pontosResgate;
  abrirModal(`<h2 style="margin-top:0">Entregar${e.gratis?'':' e receber'}</h2>
    <div class="linha entre">${placaHTML(a.placa)}<b>${esc(s.nome)}</b></div>
    ${e.gratis
      ? `<div class="info" style="margin-top:14px">${a.clube?'⭐ Lavagem do Clube':'☔ Relavagem da garantia de chuva'}: <b>o serviço não é cobrado</b>. Só cobre se houver algum extra.</div>`
      : `<label class="campo" style="margin-top:14px">Valor do serviço${s.apartir?' (preço "a partir de": ajuste se precisou)':''}<input type="number" step="0.01" inputmode="decimal" value="${e.valor}" oninput="entrega.valor=this.value;atualizarTotalEntrega()" ${e.resgate?'disabled':''}></label>`}
    <div class="grade" style="grid-template-columns:2fr 1fr">
      <label class="campo">Extra (opcional)<input value="${esc(e.extraDesc)}" oninput="entrega.extraDesc=this.value" placeholder="Ex.: cera, cheirinho"></label>
      <label class="campo">R$<input type="number" step="0.01" inputmode="decimal" value="${e.extra||''}" oninput="entrega.extra=this.value;atualizarTotalEntrega()"></label>
    </div>
    ${e.gratis?'':`<label class="campo">Desconto (%)<input type="number" min="0" max="100" value="${e.desconto}" oninput="entrega.desconto=Math.min(100,Math.max(0,Number(this.value)||0));atualizarTotalEntrega()"></label>`}
    ${!e.gratis&&noClube(cid)&&!s.noClube?'<p class="mudo pequeno" style="margin-top:-6px">Cliente do Clube: 10% de desconto já aplicado.</p>':''}
    ${podeResgatar?`<label class="check"><input type="checkbox" ${e.resgate?'checked':''} onchange="entrega.resgate=this.checked;desenharEntrega()"> Usar lavagem grátis (${D.config.pontosResgate} pontos, cliente tem ${pontosDe(cid)})</label>`:''}
    ${sinal?`<div class="linha entre"><span class="mudo">Sinal já pago</span><b>− ${brl(sinal)}</b></div>`:''}
    <div class="linha entre" style="margin-top:6px"><span>A receber agora</span><span class="valor" id="ent-falta">${brl(falta)}</span></div>
    ${s.lavagem?`<p class="mudo pequeno">☔ O cliente ganha ${D.config.chuvaHoras} h de garantia de chuva.</p>`:''}
    ${e.gratis?`<button class="btn bloco" style="margin-top:14px" onclick="if(totalEntrega()>0){aviso('Tem extra para cobrar: escolha a forma de pagamento abaixo.');return}finalizar('${a.id}',null)"><span>Entregar sem cobrança</span></button><p class="mudo pequeno" style="margin:10px 0 0">Com extra, receba em:</p>`:''}
    <div class="grade" style="grid-template-columns:1fr 1fr 1fr;margin-top:${e.gratis?'6':'14'}px">
      ${['Pix','Cartão','Dinheiro'].map(f=>`<button class="horario" onclick="finalizar('${a.id}','${f}')">${f}</button>`).join('')}
    </div>
    <button class="btn sec bloco" style="margin-top:10px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function atualizarTotalEntrega(){
  const a = D.at.find(x=>x.id===entrega.id), sinal = a.sinal?D.config.sinal:0;
  document.getElementById('ent-falta').textContent = brl(Math.max(0,totalEntrega()-sinal));
}
async function finalizar(id,forma){
  const a = D.at.find(x=>x.id===id), e = entrega, cid = donoAt(a), total = totalEntrega();
  const sinal = a.sinal?D.config.sinal:0, extra = Number(e.extra)||0;
  const pontos = e.resgate ? 0 : Math.floor(total) * (noClube(cid)?2:1);
  const campos = { status:'entregue', pago:true, forma_pagto:forma, valor:total, valor_tabela:a.valorTabela ?? a.valor,
    desconto_pct:e.desconto, extra_desc: extra ? (e.extraDesc.trim()||'Extra') : null, extra_valor: extra || null,
    resgate:!!e.resgate, pontos };
  // Se o total ficou abaixo do sinal (ex.: resgate de pontos), o sinal é devolvido ou fica como parte do pagamento
  if(sinal && total < sinal) campos.sinal_status = e.resgate ? 'devolvido' : 'usado';
  entrega = null; fecharModal();
  const ok = await acao(async()=>{
    await q(sb.from('atendimentos').update(campos).eq('id',id));
    if(e.resgate) await q(sb.from('resgates').insert({cliente_id:cid, atendimento_id:id, pontos:D.config.pontosResgate}));
    await baixaEstoque(a);
  });
  if(ok!==false) aviso(e.resgate?'Entregue. Lavagem grátis resgatada.':!forma?'Entregue sem cobrança.':`Entregue e pago no ${forma}. ${pontos} pontos creditados.`);
}

/* ---- Avisos que chegam dos clientes ---- */
function painelNotifs(){
  const n = D.notifs.filter(x=>!x.lido).sort((a,b)=>b.quando.localeCompare(a.quando));
  if(!n.length) return '';
  return `<div class="traco">AVISOS DOS CLIENTES</div><div class="painel" style="border-color:#2a45b8">${n.map(x=>`<div class="fila" style="grid-template-columns:1fr auto"><div class="pequeno">${esc(x.texto)}<div class="mudo pequeno">${new Date(x.quando).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div></div><button class="btn sec peq" onclick="lerNotifs(['${x.id}'])"><span>Ok</span></button></div>`).join('')}
    ${n.length>1?`<button class="link" onclick="lerNotifs(${esc(JSON.stringify(n.map(x=>x.id)))})">Marcar todos como vistos</button>`:''}</div>`;
}
function lerNotifs(ids){ return acao(()=>q(sb.from('notificacoes_dono').update({lido_em:new Date().toISOString()}).in('id', ids))); }

/* ---- Lembretes: grátis hoje, sem API paga ----
   1) Dono: lista do próximo dia com um toque para mandar o lembrete pronto no WhatsApp.
   2) Cliente: evento no calendário do celular (.ics) com alarme e notificação do app (Web Push na produção). */
function proximoDiaAberto(){
  for(let i=1;i<=7;i++){ const d = iso(addDias(HOJE,i)); if(expediente(d) || D.at.some(a=>a.data===d && a.status==='agendado')) return d; }
  return iso(addDias(HOJE,1));
}
function msgLembrete(a){
  const c = cliente(donoAt(a)), v = veiculo(a.placa), quando = a.data===iso(HOJE) ? 'hoje' : a.data===iso(addDias(HOJE,1)) ? 'amanhã' : DIAS[dataDe(a.data).getDay()]+', '+fmtData(a.data);
  return `Olá, ${c.nome.split(' ')[0]}! Lembrete da Vizzani: ${quando} às ${a.hora}, ${servico(a.servicoId).nome} do seu ${v.modelo} (${a.placa}). 📍 ${D.loja.endereco}. Responda SIM para confirmar. Se precisar remarcar, é pelo app ou por aqui.`;
}
function painelLembretes(){
  const d = proximoDiaAberto(), lista = D.at.filter(a=>a.data===d && a.status==='agendado').sort((a,b)=>a.hora.localeCompare(b.hora));
  if(!lista.length) return '';
  const falta = lista.filter(a=>!a.lembrete).length;
  return `<div class="traco">LEMBRETES · ${d===iso(addDias(HOJE,1))?'AMANHÃ':DIAS[dataDe(d).getDay()].toUpperCase()+' '+fmtData(d)}</div><div class="painel">
    <p class="mudo pequeno" style="margin-top:0">${falta?`${falta} de ${lista.length} ainda sem lembrete. Toque em "Lembrar": a mensagem abre pronta no WhatsApp.`:'Todos lembrados. ✅'}</p>
    ${lista.map(a=>{ const c = cliente(donoAt(a));
      const acao = !a.lembrete ? `<a class="btn zap peq" style="text-decoration:none" target="_blank" rel="noopener" onclick="marcarLembrete('${a.id}')" href="${linkZap(c.fone,msgLembrete(a))}"><span>Lembrar</span></a>`
        : a.confirmado ? `<span class="selo verde">✅ Confirmou</span>` : `<button class="btn sec peq" onclick="acao(()=>q(sb.from('atendimentos').update({confirmado:true}).eq('id','${a.id}')))"><span>Confirmou</span></button>`;
      return `<div class="fila"><span class="hora">${a.hora}</span><div class="pequeno"><b>${esc(c.nome)}</b><div class="mudo pequeno">${esc(servico(a.servicoId).nome)} · ${esc(a.placa)}${a.lembrete&&!a.confirmado?' · lembrete enviado':''}</div></div>${acao}</div>`; }).join('')}
  </div>`;
}
// Deixa o WhatsApp abrir primeiro e depois grava que o lembrete foi enviado
function marcarLembrete(id){ setTimeout(()=>acao(()=>q(sb.from('atendimentos').update({lembrete_em:new Date().toISOString()}).eq('id',id)))); }
// Notificações neste aparelho (o envio automático pelo servidor entra junto com o app instalável)
const pushAtivo = () => { try{ return localStorage.getItem('vizzani-push')==='1' && 'Notification' in window && Notification.permission==='granted'; }catch(e){ return false; } };
function ativarNotificacoes(){
  const fim = ok => { try{ localStorage.setItem('vizzani-push', ok?'1':'0'); }catch(e){} aviso(ok?'Lembretes ativados neste celular.':'Notificações bloqueadas. Libere nas configurações do navegador.'); if(document.getElementById('modal').innerHTML) fecharModal(); render(); };
  try{
    if(!('Notification' in window)) return aviso('Este navegador não mostra notificações. No iPhone, instale o app na tela inicial primeiro.');
    Notification.requestPermission().then(p=>{ fim(p==='granted'); if(p==='granted') try{ new Notification('Vizzani Estética',{body:'Pronto! Você vai receber os lembretes dos seus horários aqui.'}); }catch(e){} });
  }catch(e){ aviso('Não foi possível ativar as notificações.'); }
}
function modalLembretes(id){
  const c = {push: pushAtivo()};
  abrirModal(`<h2 style="margin-top:0">Agendado! ✅</h2><p class="sub">${esc(descAt(D.at.find(x=>x.id===id)))}</p>
    <p style="margin:14px 0 8px"><b>Não esqueça do horário:</b></p>
    <button class="btn bloco" onclick="baixarIcs('${id}')"><span>📅 Salvar na agenda do celular</span></button>
    <p class="mudo pequeno" style="margin:6px 0 10px">O celular avisa 1 h antes, mesmo sem internet.</p>
    ${c.push?'<p class="mudo pequeno">🔔 Lembretes do app já ativados.</p>':`<button class="btn sec bloco" onclick="ativarNotificacoes()"><span>🔔 Ativar lembretes do app</span></button><p class="mudo pequeno" style="margin:6px 0 0">Avisamos 1 dia antes e 2 h antes.</p>`}
    <button class="btn sec bloco" style="margin-top:12px" onclick="fecharModal()"><span>Fechar</span></button>`);
}

/* ---- Dono: remarcar, cancelar e avisar o cliente ---- */
function acoesAt(id){
  const a = D.at.find(x=>x.id===id), c = cliente(donoAt(a)), v = veiculo(a.placa);
  abrirModal(`<h2 style="margin-top:0">${esc(c.nome)}</h2><div class="linha entre">${placaHTML(a.placa,true)}<span class="mudo pequeno">${esc(descAt(a))}</span></div>
    <button class="btn bloco" style="margin-top:14px" onclick="remarcarDono('${id}')"><span>Remarcar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="cancelarDono('${id}')"><span>Cancelar (imprevisto da loja)</span></button>
    ${a.data===iso(HOJE)?`<button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal();mudar('${id}','faltou')"><span>Cliente não veio</span></button>`:''}
    <a class="btn zap bloco" style="margin-top:8px;text-decoration:none" target="_blank" rel="noopener" href="${linkZap(c.fone,`Olá, ${c.nome.split(' ')[0]}! Aqui é da Vizzani, sobre o seu horário: ${descAt(a)} (${v.modelo}).`)}"><span>Conversar no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}
let remDono = null;
function remarcarDono(id){
  const a = D.at.find(x=>x.id===id);
  remDono = {id, motivo: remDono?.id===id ? remDono.motivo : ''};
  ag = {data:a.data, hora:null};
  desenharRemDono();
}
function desenharRemDono(){
  const a = D.at.find(x=>x.id===remDono.id), dur = servico(a.servicoId).dur;
  // reaproveita o seletor, mas re-renderiza dentro do modal
  abrirModal(`<h2 style="margin-top:0">Remarcar</h2><p class="sub">${esc(cliente(donoAt(a)).nome)} · ${esc(descAt(a))}</p>
    ${seletorDiaHora(dur, a.id, true).replace(/render\(\)/g,'desenharRemDono()')}
    <label class="campo" style="margin-top:14px">Motivo para o cliente<input value="${esc(remDono.motivo)}" oninput="remDono.motivo=this.value" placeholder="Ex.: imprevisto na equipe"></label>
    <button class="btn bloco" ${ag.hora?'':'disabled'} onclick="confirmarRemDono()"><span>Remarcar e avisar o cliente</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="ag={};fecharModal()"><span>Voltar</span></button>`);
}
async function confirmarRemDono(){
  const a = D.at.find(x=>x.id===remDono.id), c = cliente(donoAt(a)), antes = `${fmtData(a.data)} às ${a.hora}`;
  const motivo = remDono.motivo.trim(), nova = {data:ag.data, hora:ag.hora};
  if(!cabe(nova.data, nova.hora, servico(a.servicoId).dur, a.id)){ aviso('Esse horário não tem mais vaga. Escolha outro.'); ag.hora=null; return desenharRemDono(); }
  const texto = `Precisamos mudar seu horário (${servico(a.servicoId).nome}): de ${antes} para ${DIAS[dataDe(nova.data).getDay()]} ${fmtData(nova.data)} às ${nova.hora}.${motivo?' Motivo: '+motivo+'.':''} Se não puder, remarque pelo app.`;
  fecharModal();
  const ok = await acao(async()=>{
    await q(sb.from('atendimentos').update({data:nova.data, hora:nova.hora, remarcado_de:`${fmtData(a.data)} ${a.hora}`, atraso_min:null, lembrete_em:null, confirmado:false}).eq('id',a.id));
    await enviarRecado(c.id, a.id, texto);
  });
  ag={}; remDono=null;
  if(ok!==false) modalAvisarCliente(c, `Olá, ${c.nome.split(' ')[0]}! ${texto} Desculpe o transtorno. 🙏`, 'Horário remarcado');
}
function cancelarDono(id){
  const a = D.at.find(x=>x.id===id);
  abrirModal(`<h2 style="margin-top:0">Cancelar pela loja</h2><p class="sub">${esc(descAt(a))}</p>
    ${a.sinal?`<div class="info" style="margin-top:12px">Cancelamento da loja: devolva o sinal de ${brl(D.config.sinal)} ao cliente.</div>`:''}
    <label class="campo" style="margin-top:12px">Motivo para o cliente<input id="cd-motivo" placeholder="Ex.: falta de energia"></label>
    <button class="btn bloco" onclick="confirmarCancelDono('${id}')"><span>Cancelar e avisar o cliente</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
async function confirmarCancelDono(id){
  const a = D.at.find(x=>x.id===id), c = cliente(donoAt(a)), motivo = document.getElementById('cd-motivo').value.trim();
  const texto = `Infelizmente precisamos cancelar seu horário: ${descAt(a)}.${motivo?' Motivo: '+motivo+'.':''}${a.sinal?' O sinal será devolvido.':''} Agende um novo horário pelo app quando quiser.`;
  fecharModal();
  const ok = await acao(async()=>{
    await q(sb.from('atendimentos').update({status:'cancelado', cancelado_por:'loja', motivo_cancel:motivo||null, ...(a.sinal?{sinal_status:'devolvido'}:{})}).eq('id',id));
    await enviarRecado(c.id, a.id, texto);
  });
  if(ok!==false) modalAvisarCliente(c, `Olá, ${c.nome.split(' ')[0]}! ${texto} Desculpe o transtorno. 🙏`, 'Agendamento cancelado');
}
function modalAvisarCliente(c, msg, titulo){
  abrirModal(`<h2 style="margin-top:0">${titulo}</h2><p class="sub">${esc(c.nome)} já vê o recado ao abrir o app. Mande também no WhatsApp para garantir que ele(a) saiba a tempo.</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="${linkZap(c.fone,msg)}"><span>Avisar no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}

/* ---- Agenda do dono ---- */
let diaAgenda = iso(HOJE);
function telaAgendaDono(){
  const d = diaAgenda, dt = dataDe(d), exp = expediente(d), bls = D.bloqueios.filter(b=>b.data===d);
  const lista = D.at.filter(a=>a.data===d && a.status!=='cancelado').sort((a,b)=>a.hora.localeCompare(b.hora));
  const cancelados = D.at.filter(a=>a.data===d && a.status==='cancelado');
  const rot = dt.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
  let h = `<div style="margin-top:18px"><h1>Agenda</h1><p class="sub">Veja, remarque e bloqueie horários.</p></div>
    <div class="dia-nav"><button onclick="diaAgenda=iso(addDias(dataDe(diaAgenda),-1));render()" aria-label="Dia anterior">‹</button><div>${rot.charAt(0).toUpperCase()+rot.slice(1)}${d===iso(HOJE)?' · hoje':''}</div><button onclick="diaAgenda=iso(addDias(dataDe(diaAgenda),1));render()" aria-label="Próximo dia">›</button></div>
    <div class="chips" style="margin-top:10px">${Array.from({length:14},(_,i)=>{ const x=iso(addDias(HOJE,i)); const n=D.at.filter(a=>a.data===x && OCUPA(a)).length;
      return `<button class="chip ${x===d?'on':''}" onclick="diaAgenda='${x}';render()">${i===0?'hoje':DIAS[dataDe(x).getDay()]}<b>${dataDe(x).getDate()}</b><span class="mudo" style="font-size:11px">${expediente(x)?n+' carro'+(n===1?'':'s'):'fechado'}</span></button>`; }).join('')}</div>
    <div class="grade" style="grid-template-columns:1fr 1fr;margin-top:12px">
      <button class="btn peq" onclick="novoAgDono()"><span>+ Agendar cliente</span></button>
      <button class="btn sec peq" onclick="abrirBloqueio()"><span>Bloquear horário</span></button>
    </div>`;
  bls.forEach(b=> h += `<div class="bloq" style="margin-top:12px"><div class="linha entre"><span>⛔ ${b.diaTodo?'Dia todo':b.ini+'–'+b.fim}: ${esc(b.motivo)}</span><button class="btn sec peq" onclick="removerBloqueio('${b.id}')"><span>Desbloquear</span></button></div></div>`);
  if(!exp){
    h += `<div class="painel vazio" style="margin-top:12px">${bls.some(b=>b.diaTodo)?'Dia bloqueado.':'A Vizzani não abre neste dia (ajuste em Ajustes › Horário de funcionamento).'}</div>`;
    if(lista.length) h += `<div class="erro" style="margin-top:12px">Há ${lista.length} agendamento(s) neste dia fechado. Remarque ou cancele abaixo.</div>`;
  }
  h += `<div class="traco">HORÁRIOS</div><div class="painel">`;
  const slots = horariosDo(d);
  const inicioDe = hr => lista.filter(a=>a.hora>=hr && a.hora<hhmm(mins(hr)+D.config.passo));
  const foraGrade = lista.filter(a=>!slots.some(hr=>a.hora>=hr && a.hora<hhmm(mins(hr)+D.config.passo)));
  foraGrade.forEach(a=> h += `<div class="slot"><span class="hora">${a.hora}</span><div>${cartaoAt(a)}</div></div>`);
  slots.forEach(hr=>{
    const aqui = inicioDe(hr);
    const continua = lista.filter(a=>OCUPA(a) && mins(a.hora)<mins(hr) && fimAt(a)>mins(hr));
    const livres = D.config.capacidade - ocupacao(d,hr);
    h += `<div class="slot"><span class="hora">${hr}</span><div>${aqui.map(cartaoAt).join('')}
      ${continua.map(a=>`<div class="cartao-at cont pequeno">↳ ${esc(servico(a.servicoId).nome)} · ${esc(a.placa)} (continua)</div>`).join('')}
      ${livres>0 && !jaPassou(d,hr)?`<button class="livre" onclick="novoAgDono('${hr}')">+ ${livres} vaga${livres>1?'s':''} livre${livres>1?'s':''}</button>`:livres<=0?'<span class="mudo pequeno">lotado</span>':''}</div></div>`;
  });
  if(!slots.length && !foraGrade.length) h += `<div class="vazio">Sem horários neste dia.</div>`;
  h += `</div>`;
  if(cancelados.length) h += `<div class="traco">CANCELADOS</div><div class="painel">${cancelados.map(a=>`<div class="fila" style="grid-template-columns:52px 1fr"><span class="hora">${a.hora}</span><div class="pequeno">${esc(cliente(donoAt(a))?.nome)} · ${esc(servico(a.servicoId).nome)}<div class="mudo pequeno">por ${a.canceladoPor==='loja'?'loja':'cliente'}${a.motivoCancel?': '+esc(a.motivoCancel):''}${a.sinalStatus?' · sinal '+a.sinalStatus:''}</div></div></div>`).join('')}</div>`;
  return h;
}
function cartaoAt(a){
  const c = cliente(donoAt(a)), s = servico(a.servicoId);
  const st = {agendado:'Agendado',recebido:'Em atendimento',pronto:'Pronto',entregue:'Entregue',faltou:'Não veio'}[a.status];
  return `<div class="cartao-at"><div class="linha entre"><b class="pequeno">${esc(s.nome)}</b>${placaHTML(a.placa,true)}</div>
    <div class="mudo pequeno">${esc(c?.nome)} · até ~${hhmm(fimAt(a))} · ${st}${a.sinal?' · sinal pago':''}${a.origem==='app'?' · pelo app':''}</div>
    ${a.atraso&&a.status==='agendado'?`<span class="selo amarelo">⏱ atraso ${a.atraso} min</span> `:''}${a.remarcadoDe?`<span class="selo">era ${esc(a.remarcadoDe)}</span>`:''}
    ${a.status==='agendado'?`<div class="acoes"><button class="btn sec peq" onclick="remarcarDono('${a.id}')"><span>Remarcar</span></button><button class="btn sec peq" onclick="acoesAt('${a.id}')"><span>Mais</span></button></div>`:''}</div>`;
}

/* Dono agenda pelo app (cliente ligou ou mandou WhatsApp) */
let novoAg = null;
function novoAgDono(hora){
  novoAg = {placa:'', servicoId:null, hora:hora||null, busca:''};
  ag = {data:diaAgenda, hora:hora||null};
  desenharNovoAg();
}
function desenharNovoAg(){
  const v = veiculo(novoAg.placa);
  const achados = novoAg.busca.length>=2 ? D.veiculos.filter(x=>x.placa.includes(novoAg.busca.toUpperCase()) || (cliente(x.clienteId)?.nome||'').toLowerCase().includes(novoAg.busca.toLowerCase())).slice(0,6) : [];
  let h = `<h2 style="margin-top:0">Agendar cliente</h2>`;
  if(!v){
    h += `<label class="campo">Placa ou nome do cliente<input id="na-busca" value="${esc(novoAg.busca)}" oninput="novoAg.busca=this.value;desenharNovoAg();const el=document.getElementById('na-busca');el.focus();el.setSelectionRange(el.value.length,el.value.length)"></label>
      ${achados.map(x=>`<button class="servico" onclick="novoAg.placa='${x.placa}';desenharNovoAg()"><span>${placaHTML(x.placa,true)} <span class="pequeno">${esc(x.modelo)}</span></span><span class="pequeno">${esc(cliente(x.clienteId)?.nome)}</span></button>`).join('')}
      ${novoAg.busca.length>=2&&!achados.length?`<p class="mudo pequeno">Nada encontrado. Cadastre a placa primeiro no Balcão.</p>`:''}`;
  } else {
    const dur = novoAg.servicoId ? servico(novoAg.servicoId).dur : 40;
    if(ag.hora && !cabe(ag.data,ag.hora,dur) ) ag.hora = null;
    h += `<div class="linha entre">${placaHTML(v.placa,true)}<span class="pequeno">${esc(v.modelo)} · ${esc(cliente(v.clienteId).nome)}</span></div><button class="link" onclick="novoAg.placa='';desenharNovoAg()">Trocar</button>
      <div class="traco">SERVIÇO</div>${D.servicos.filter(s=>s.precos[v.porte]!=null).map(s=>`<button class="servico ${novoAg.servicoId===s.id?'on':''}" onclick="novoAg.servicoId='${s.id}';desenharNovoAg()"><b class="pequeno">${esc(s.nome)}</b><span class="valor" style="font-size:16px">${brl(s.precos[v.porte])}</span></button>`).join('')}
      ${novoAg.servicoId?seletorDiaHora(dur, null, true).replace(/render\(\)/g,'desenharNovoAg()'):''}
      ${novoAg.servicoId&&ag.data?(()=>{ const el = clubeElegivel(v.clienteId, novoAg.servicoId, ag.data); novoAg.clube = el.ok && novoAg.usarClube!==false; return avisoClubeHTML(v.clienteId, el, novoAg.clube, 'novoAg.usarClube=this.checked;desenharNovoAg()'); })():''}
      <button class="btn bloco" style="margin-top:14px" ${novoAg.servicoId&&ag.hora?'':'disabled'} onclick="salvarNovoAgDono()"><span>${novoAg.clube?'Agendar pelo Clube':'Agendar'}</span></button>`;
  }
  h += `<button class="btn sec bloco" style="margin-top:8px" onclick="novoAg=null;ag={};fecharModal()"><span>Cancelar</span></button>`;
  abrirModal(h);
}
async function salvarNovoAgDono(){
  const v = veiculo(novoAg.placa), s = servico(novoAg.servicoId), c = cliente(v.clienteId), preco = s.precos[v.porte];
  if(!cabe(ag.data, ag.hora, s.dur)){ aviso('Esse horário não tem mais vaga. Escolha outro.'); ag.hora=null; return desenharNovoAg(); }
  const a = {servicoId:s.id, data:ag.data, hora:ag.hora};
  const clube = !!novoAg.clube && clubeElegivel(c.id, s.id, a.data).ok;
  const pelo = clube ? ' pelo Clube (sem cobrança)' : '';
  fecharModal();
  const ok = await acao(async()=>{
    const [novo] = await q(sb.from('atendimentos').insert({placa:v.placa, servico_id:s.id, data:a.data, hora:a.hora, status:'agendado', cliente_id:c.id,
      valor:clube?0:preco, valor_tabela:preco, clube, origem:'loja'}).select('id'));
    await enviarRecado(c.id, novo.id, `Agendamos para você: ${descAt(a)} (${v.modelo})${pelo}.`);
  });
  diaAgenda = a.data; novoAg=null; ag={};
  if(ok!==false){ render(); modalAvisarCliente(c, `Olá, ${c.nome.split(' ')[0]}! Seu horário na Vizzani está confirmado: ${descAt(a)} (${v.modelo})${pelo}. Até lá! 🚗`, 'Agendado'); }
}

/* Bloqueios: imprevisto, feriado, folga */
function abrirBloqueio(){
  abrirModal(`<h2 style="margin-top:0">Bloquear horário</h2><p class="sub">Ninguém consegue agendar no período bloqueado. Quem já estava marcado aparece para você remarcar e avisar.</p>
    <label class="campo" style="margin-top:12px">Dia<input type="date" id="bl-data" value="${diaAgenda}" min="${iso(HOJE)}"></label>
    <label class="check"><input type="checkbox" id="bl-todo" onchange="document.getElementById('bl-horas').style.display=this.checked?'none':''"> Dia inteiro</label>
    <div class="grade" style="grid-template-columns:1fr 1fr" id="bl-horas">
      <label class="campo">De<input type="time" id="bl-ini" value="08:00" step="1800"></label>
      <label class="campo">Até<input type="time" id="bl-fim" value="12:00" step="1800"></label>
    </div>
    <label class="campo">Motivo<select id="bl-motivo">${['Imprevisto','Feriado','Folga','Manutenção de equipamento','Falta de energia/água','Outro'].map(m=>`<option>${m}</option>`).join('')}</select></label>
    <button class="btn bloco" onclick="salvarBloqueio()"><span>Bloquear</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
async function salvarBloqueio(){
  const data = document.getElementById('bl-data').value, todo = document.getElementById('bl-todo').checked;
  const ini = document.getElementById('bl-ini').value, fim = document.getElementById('bl-fim').value, motivo = document.getElementById('bl-motivo').value;
  if(!data) return aviso('Escolha o dia.');
  if(!todo && (!ini || !fim || ini>=fim)) return aviso('O horário final precisa ser depois do inicial.');
  const b = {data, motivo, diaTodo:todo, ini:todo?'00:00':ini, fim:todo?'23:59':fim};
  fecharModal();
  const ok = await acao(()=>q(sb.from('bloqueios').insert({data, motivo, dia_todo:todo, inicio:todo?null:ini, fim:todo?null:fim})));
  if(ok===false) return;
  diaAgenda = data; render();
  const afetados = D.at.filter(a=>a.data===data && a.status==='agendado' && (todo || (mins(a.hora)<mins(b.fim) && fimAt(a)>mins(b.ini))));
  if(!afetados.length){ aviso('Horário bloqueado.'); return; }
  abrirModal(`<h2 style="margin-top:0">${afetados.length} cliente${afetados.length>1?'s':''} afetado${afetados.length>1?'s':''}</h2><p class="sub">Esses agendamentos caem no período bloqueado. Remarque ou cancele cada um; o app avisa o cliente e prepara a mensagem de WhatsApp.</p>
    ${afetados.map(a=>`<div class="cartao-at" style="margin-top:10px"><div class="linha entre"><b class="pequeno">${esc(cliente(donoAt(a)).nome)}</b><span class="hora">${a.hora}</span></div><div class="mudo pequeno">${esc(servico(a.servicoId).nome)} · ${esc(a.placa)}</div>
      <div class="acoes"><button class="btn peq" onclick="remDono={id:'${a.id}',motivo:'${esc(motivo)}'};remarcarDono('${a.id}')"><span>Remarcar</span></button><button class="btn sec peq" onclick="cancelarDono('${a.id}')"><span>Cancelar</span></button></div></div>`).join('')}
    <button class="btn sec bloco" style="margin-top:12px" onclick="fecharModal()"><span>Resolver depois</span></button>`);
}
function removerBloqueio(id){ if(!confirm('Desbloquear este período? Os horários voltam a aparecer para os clientes.')) return; return acao(()=>q(sb.from('bloqueios').delete().eq('id',id)), 'Período desbloqueado.'); }

/* ---- Caixa ---- */
let periodoCaixa = 'mes';
function periodo(p){
  const h = iso(HOJE), y = HOJE.getFullYear(), m = HOJE.getMonth();
  if(p==='hoje') return [h,h,'Hoje'];
  if(p==='7d') return [iso(addDias(HOJE,-6)),h,'Últimos 7 dias'];
  if(p==='mes') return [iso(new Date(y,m,1)),h,'Este mês'];
  return [iso(new Date(y,m-1,1)),iso(new Date(y,m,0)),'Mês passado'];
}
// Todas as movimentações de dinheiro: serviços pagos, sinais retidos e lançamentos manuais
function movimentos(ini,fim){
  const r = [], dentro = d => d>=ini && d<=fim;
  D.at.forEach(a=>{
    if(!dentro(a.data)) return;
    const quem = cliente(donoAt(a))?.nome || '', s = servico(a.servicoId)?.nome || '';
    const sinal = a.sinal ? D.config.sinal : 0, base = {data:a.data, tipo:'entrada', atId:a.id, pessoa:quem, detalhes:`${a.placa} · ${veiculo(a.placa)?.modelo||''}`};
    if(a.status==='entregue' && a.pago && a.valor>0){
      if(sinal && a.valor>=sinal){
        r.push({...base, cat:'Serviços', desc:`Sinal · ${s}`, valor:sinal, forma:'Pix', sid:a.servicoId});
        if(a.valor>sinal) r.push({...base, cat:'Serviços', desc:s, valor:a.valor-sinal, forma:a.forma||'—', sid:a.servicoId});
      } else r.push({...base, cat:'Serviços', desc:s, valor:a.valor, forma:a.forma||'—', sid:a.servicoId});
    }
    if(sinal && a.sinalStatus==='retido') r.push({...base, cat:'Sinais retidos', desc:`Sinal retido (${a.status==='faltou'?'não veio':'cancelou em cima da hora'})`, valor:sinal, forma:'Pix'});
  });
  D.lancamentos.filter(l=>dentro(l.data)).forEach(l=>r.push({...l, manual:true}));
  return r.sort((a,b)=>b.data.localeCompare(a.data));
}
let subCaixa = 'dinheiro';
const abasCaixa = () => `<div class="abas-entrar" style="margin:16px 0 0"><button class="${subCaixa==='dinheiro'?'on':''}" onclick="subCaixa='dinheiro';render()">Dinheiro</button><button class="${subCaixa==='estoque'?'on':''}" onclick="subCaixa='estoque';render()">Estoque${produtosBaixos().length?' ⚠':''}</button></div>`;
function telaCaixa(){
  if(subCaixa==='estoque') return telaEstoque();
  const [ini,fim,rotulo] = periodo(periodoCaixa), mv = movimentos(ini,fim);
  const ent = mv.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+m.valor,0), sai = mv.filter(m=>m.tipo==='saida').reduce((s,m)=>s+m.valor,0);
  const servicos = D.at.filter(a=>a.status==='entregue' && a.data>=ini && a.data<=fim);
  const pagos = servicos.filter(a=>a.valor>0), ticket = pagos.length ? pagos.reduce((s,a)=>s+a.valor,0)/pagos.length : 0;
  const aReceber = D.at.filter(a=>a.data===iso(HOJE) && ['agendado','recebido','pronto'].includes(a.status)).reduce((s,a)=>s+Math.max(0,a.valor-(a.sinal?D.config.sinal:0)),0);
  const devolver = D.at.filter(a=>a.sinalStatus==='devolvido' && !a.sinalDevolvido);
  let h = `<div style="margin-top:18px"><h1>Caixa</h1><p class="sub">Entradas, saídas e saldo da Vizzani.</p></div>${abasCaixa()}
    <div class="chips" style="margin-top:12px">${[['hoje','Hoje'],['7d','7 dias'],['mes','Este mês'],['mesant','Mês passado']].map(([k,n])=>`<button class="chip ${periodoCaixa===k?'on':''}" onclick="periodoCaixa='${k}';render()">${n}</button>`).join('')}</div>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi destaque"><b class="${ent-sai>=0?'':'sai'}">${brl(ent-sai)}</b><span>saldo · ${rotulo.toLowerCase()}</span></div>
      <div class="kpi"><b class="entra">${brl(ent)}</b><span>entradas</span></div>
      <div class="kpi"><b class="sai">${brl(sai)}</b><span>saídas</span></div>
      <div class="kpi"><b>${servicos.length}</b><span>serviços entregues</span></div>
      <div class="kpi"><b>${brl(ticket)}</b><span>ticket médio</span></div>
    </div>
    ${periodoCaixa==='hoje'||periodoCaixa==='mes'?`<p class="mudo pequeno">Ainda a receber hoje (carros na agenda): <b>${brl(aReceber)}</b></p>`:''}
    <div class="grade" style="grid-template-columns:1fr 1fr;margin-top:12px">
      <button class="btn peq" onclick="abrirLancamento('saida')"><span>− Lançar despesa</span></button>
      <button class="btn sec peq" onclick="abrirLancamento('entrada')"><span>+ Entrada avulsa</span></button>
    </div>`;
  if(devolver.length) h += `<div class="erro" style="margin-top:12px"><b>Sinais para devolver (${devolver.length})</b>${devolver.map(a=>`<div class="linha entre" style="margin-top:8px"><span class="pequeno">${esc(cliente(donoAt(a)).nome)} · ${fmtData(a.data)} · ${brl(D.config.sinal)}</span><button class="btn sec peq" onclick="acao(()=>q(sb.from('atendimentos').update({sinal_devolvido_em:new Date().toISOString()}).eq('id','${a.id}')),'Sinal marcado como devolvido.')"><span>Devolvido</span></button></div>`).join('')}</div>`;
  // Entradas por dia (uma série: o título já nomeia)
  if(periodoCaixa!=='hoje'){
    const dias = diasEntre(ini,fim)+1, porDia = Array.from({length:dias},(_,i)=>{ const d=iso(addDias(dataDe(ini),i)); return {d, v:mv.filter(m=>m.data===d && m.tipo==='entrada').reduce((s,m)=>s+m.valor,0)}; });
    const max = Math.max(1,...porDia.map(x=>x.v));
    h += `<div class="traco">ENTRADAS POR DIA</div><div class="painel"><div class="grafico" role="img" aria-label="Entradas por dia">${porDia.map(x=>`<i style="height:${x.v/max*100}%" title="${fmtData(x.d)}: ${brl(x.v)}"></i>`).join('')}</div>
      <div class="grafico-rot"><span>${fmtData(ini)}</span><span>maior dia: ${brl(max)}</span><span>${fmtData(fim)}</span></div></div>`;
  }
  const soma = (lista, chave) => Object.entries(lista.reduce((o,m)=>(o[m[chave]]=(o[m[chave]]||0)+m.valor,o),{})).sort((a,b)=>b[1]-a[1]);
  const porForma = soma(mv.filter(m=>m.tipo==='entrada'),'forma'), porCat = soma(mv.filter(m=>m.tipo==='saida'),'cat');
  const porServ = soma(mv.filter(m=>m.sid).map(m=>({...m, nome:servico(m.sid).nome})),'nome');
  const tabela = (tit, linhas, total) => linhas.length ? `<div class="traco">${tit}</div><div class="painel"><table class="tabela">${linhas.map(([k,v])=>`<tr><td>${esc(k)}</td><td style="text-align:right">${brl(v)}</td><td style="text-align:right;width:52px" class="mudo">${total?Math.round(v/total*100)+'%':''}</td></tr>`).join('')}</table></div>` : '';
  h += tabela('ENTRADAS POR FORMA DE PAGAMENTO', porForma, ent) + tabela('FATURAMENTO POR SERVIÇO', porServ, porServ.reduce((s,x)=>s+x[1],0)) + tabela('DESPESAS POR CATEGORIA', porCat, sai);
  const gaveta = movimentos(iso(HOJE),iso(HOJE)).filter(m=>m.forma==='Dinheiro').reduce((s,m)=>s+(m.tipo==='entrada'?m.valor:-m.valor),0);
  if(periodoCaixa==='hoje') h += `<div class="painel" style="margin-top:12px"><b>Fechamento do dia</b><p class="mudo pequeno" style="margin:4px 0 0">Dinheiro que deveria entrar na gaveta hoje: <b>${brl(gaveta)}</b> (entradas em dinheiro menos despesas pagas em dinheiro).</p></div>`;
  movCache = mv;
  h += `<div class="traco">MOVIMENTAÇÕES</div><p class="mudo pequeno" style="margin-top:-4px">Toque numa linha para ver os detalhes.</p><div class="painel">${mv.length?mv.map((m,i)=>`<div class="mov" role="button" tabindex="0" style="cursor:pointer" onclick="verMovimento(${i})"><span class="hora" style="font-size:15px">${fmtData(m.data)}</span><div>${esc(m.desc)}${m.pessoa?` · <span style="color:var(--prata)">${esc(m.pessoa)}</span>`:''}<div class="mudo pequeno">${esc(m.cat)} · ${esc(m.forma)}${m.detalhes?' · '+esc(m.detalhes.length>40?m.detalhes.slice(0,40)+'…':m.detalhes):''}</div></div><div style="text-align:right"><b class="${m.tipo==='entrada'?'entra':'sai'}">${m.tipo==='entrada'?'+':'−'} ${brl(m.valor)}</b><div class="mudo pequeno">detalhes ›</div></div></div>`).join(''):'<div class="vazio">Nenhuma movimentação no período.</div>'}</div>
    <button class="btn sec bloco" style="margin-top:12px" onclick="exportarCaixa()"><span>Baixar planilha (CSV) para o contador</span></button>`;
  return h;
}
const CATS = {saida:['Produtos','Aluguel','Água/Luz','Salários/diárias','Manutenção','Impostos/taxas','Marketing','Outros'], entrada:['Venda de produto','Serviço avulso','Clube','Outros']};
// Lista de nomes de clientes para sugerir no campo "Quem" (quem comprou)
const sugestoesClientes = () => `<datalist id="lista-clientes">${D.clientes.map(c=>`<option value="${esc(c.nome)}">${esc(fmtFone(c.fone))}</option>`).join('')}</datalist>`;
const clientePorNome = nome => { const n = nome.trim().toLowerCase(); const achados = D.clientes.filter(c=>c.nome.trim().toLowerCase()===n); return achados.length===1 ? achados[0] : null; };
function abrirLancamento(tipo){
  const saida = tipo==='saida';
  abrirModal(`<h2 style="margin-top:0">${saida?'Lançar despesa':'Entrada avulsa'}</h2>
    <label class="campo">Descrição<input id="lc-desc" placeholder="${saida?'Ex.: shampoo automotivo 5 L':'Ex.: venda de cheirinho'}"></label>
    <div class="grade" style="grid-template-columns:1fr 1fr"><label class="campo">Valor (R$)<input id="lc-valor" type="number" step="0.01" inputmode="decimal"></label><label class="campo">Data<input id="lc-data" type="date" value="${iso(HOJE)}"></label></div>
    <label class="campo">${saida?'Fornecedor / de quem comprou':'Quem comprou'} (opcional)<input id="lc-pessoa" ${saida?'':'list="lista-clientes"'} placeholder="${saida?'Ex.: Distribuidora Brilho Car':'Nome do cliente'}"></label>
    ${saida?'':sugestoesClientes()}
    <label class="campo">Detalhes (opcional)<textarea class="obs" id="lc-det" placeholder="${saida?'Ex.: 2 galões de 5 L, nota fiscal 1234':'Ex.: 2 cheirinhos de baunilha'}"></textarea></label>
    <label class="campo">Categoria<select id="lc-cat">${CATS[tipo].map(c=>`<option>${c}</option>`).join('')}</select></label>
    <label class="campo">Forma<select id="lc-forma">${['Pix','Dinheiro','Cartão','Boleto'].map(c=>`<option>${c}</option>`).join('')}</select></label>
    <button class="btn bloco" onclick="salvarLancamento('${tipo}')"><span>Salvar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function salvarLancamento(tipo){
  const desc = document.getElementById('lc-desc').value.trim(), valor = Number(document.getElementById('lc-valor').value), data = document.getElementById('lc-data').value;
  if(!desc) return aviso('Informe a descrição.'); if(!(valor>0)) return aviso('Informe um valor maior que zero.'); if(!data) return aviso('Informe a data.');
  const pessoa = document.getElementById('lc-pessoa').value.trim(), detalhes = document.getElementById('lc-det').value.trim();
  const cli = tipo==='entrada' && pessoa ? clientePorNome(pessoa) : null;
  if(document.getElementById('lc-cat').value==='Clube' && !cli) return aviso('Mensalidade do Clube: escolha o cliente na lista de "Quem comprou" (ou use Clientes › Clube › Recebi).');
  const linha = {tipo, descricao:desc, valor, data, categoria:document.getElementById('lc-cat').value, forma:document.getElementById('lc-forma').value,
    pessoa:pessoa||null, detalhes:detalhes||null, cliente_id:cli?.id||null};
  fecharModal();
  return acao(()=>q(sb.from('lancamentos').insert(linha)), 'Lançado no caixa.');
}
function apagarLancamento(id){ if(!confirm('Apagar este lançamento?')) return; fecharModal(); return acao(()=>q(sb.from('lancamentos').delete().eq('id',id)), 'Lançamento apagado.'); }
/* Detalhes de uma movimentação: serviço (dados do atendimento) ou lançamento manual (dá para completar quem/detalhes) */
let movCache = [];
function verMovimento(i){
  const m = movCache[i]; if(!m) return;
  const cab = `<h2 style="margin-top:0">${m.tipo==='entrada'?'Entrada':'Saída'} · <span class="${m.tipo==='entrada'?'entra':'sai'}">${brl(m.valor)}</span></h2>
    <p class="sub">${esc(m.desc)} · ${fmtData(m.data)}/${m.data.slice(0,4)}</p>`;
  const linha = (rot, val) => val ? `<tr><td class="mudo">${rot}</td><td>${val}</td></tr>` : '';
  if(m.atId){
    const a = D.at.find(x=>x.id===m.atId), c = cliente(donoAt(a)), v = veiculo(a.placa), s = servico(a.servicoId);
    return abrirModal(cab + `<div class="linha entre" style="margin-top:12px">${placaHTML(a.placa,true)}<span class="pequeno">${esc(v?.modelo||'')}</span></div>
      <table class="tabela" style="margin-top:10px">
        ${linha('Cliente', esc(c?.nome||'—'))}${linha('WhatsApp', c?fmtFone(c.fone):'')}
        ${linha('Serviço', esc(s?.nome||''))}${linha('Horário', `${fmtData(a.data)} às ${a.hora}`)}
        ${linha('Preço de tabela', a.valorTabela!=null?brl(a.valorTabela):'')}
        ${linha('Extra', a.extra?`${esc(a.extra.desc)} · ${brl(a.extra.valor)}`:'')}
        ${linha('Desconto', a.desconto?a.desconto+'%':'')}
        ${linha('Valor cobrado', brl(a.valor))}
        ${linha('Sinal', a.sinal?`${brl(D.config.sinal)} (${{pago:'pago, descontado na entrega',usado:'usado no pagamento',devolvido:'devolvido',retido:'ficou com a loja'}[a.sinalStatus]||a.sinalStatus||'pago'})`:'')}
        ${linha('Pagamento', a.forma?esc(a.forma):'')}
        ${linha('Pontos', a.status==='entregue'?String(a.pontos||0):'')}
        ${linha('Origem', {app:'agendado pelo app',loja:'agendado pela loja',balcao:'atendido no balcão'}[a.origem]||'')}
        ${linha('Status', a.status==='faltou'?'não veio':a.status==='cancelado'?`cancelado por ${a.canceladoPor||'—'}${a.motivoCancel?': '+esc(a.motivoCancel):''}`:esc(a.status))}
      </table>
      ${a.vistoria?`<button class="btn sec bloco" style="margin-top:12px" onclick="verVistoria('${a.id}')"><span>Ver vistoria de entrada</span></button>`:''}
      <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal();buscaPlaca='${a.placa}';irPara('balcao')"><span>Abrir ficha do veículo</span></button>
      <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
  }
  const saida = m.tipo==='saida', cli = m.clienteId ? cliente(m.clienteId) : null;
  abrirModal(cab + `<table class="tabela" style="margin-top:10px">
      ${linha('Categoria', esc(m.cat))}${linha('Forma', esc(m.forma))}
      ${linha('Lançado em', m.criadoEm?new Date(m.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'')}
      ${cli?linha('Cliente no cadastro', `${esc(cli.nome)} · ${fmtFone(cli.fone)}`):''}
    </table>
    <label class="campo" style="margin-top:12px">${saida?'Fornecedor / de quem comprou':'Quem comprou'}<input id="mv-pessoa" ${saida?'':'list="lista-clientes"'} value="${esc(m.pessoa)}"></label>
    ${saida?'':sugestoesClientes()}
    <label class="campo">Detalhes<textarea class="obs" id="mv-det">${esc(m.detalhes)}</textarea></label>
    <button class="btn bloco" onclick="salvarDetalhesMov('${m.id}','${m.tipo}')"><span>Salvar detalhes</span></button>
    <button class="btn sec bloco" style="margin-top:8px;border-color:#8a2424" onclick="apagarLancamento('${m.id}')"><span>Apagar lançamento</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}
function salvarDetalhesMov(id, tipo){
  const pessoa = document.getElementById('mv-pessoa').value.trim(), detalhes = document.getElementById('mv-det').value.trim();
  const cli = tipo==='entrada' && pessoa ? clientePorNome(pessoa) : null;
  fecharModal();
  return acao(()=>q(sb.from('lancamentos').update({pessoa:pessoa||null, detalhes:detalhes||null, cliente_id:cli?.id||null}).eq('id',id)), 'Detalhes salvos.');
}
function exportarCaixa(){
  const [ini,fim] = periodo(periodoCaixa), q = s => '"'+String(s??'').replace(/"/g,'""')+'"';
  const linhas = [['Data','Tipo','Categoria','Descrição','Quem','Detalhes','Forma','Valor'].join(';'), ...movimentos(ini,fim).map(m=>[fmtData(m.data)+'/'+m.data.slice(0,4), m.tipo==='entrada'?'Entrada':'Saída', q(m.cat), q(m.desc), q(m.pessoa), q(m.detalhes), m.forma, (m.tipo==='entrada'?'':'-')+m.valor.toFixed(2).replace('.',',')].join(';'))];
  baixar(`caixa-vizzani-${ini}-a-${fim}.csv`, '﻿'+linhas.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---- Estoque: compra entra, serviço entregue dá baixa sozinho, alerta quando acaba ---- */
const r3 = x => Math.round(x*1000)/1000;
const fmtQtd = (p,q=p.qtd) => String(r3(q)).replace('.',',')+' '+p.un;
const produtosBaixos = () => D.produtos.filter(p=>p.qtd<=p.min);
// Grava a movimentação e o novo saldo do produto
async function movEstoque(p, tipo, qtd, obs, valor, extra={}){
  await q(sb.from('estoque_movimentos').insert({produto_id:p.id, tipo, qtd:r3(qtd), obs:obs||null, valor:valor||null, atendimento_id:extra.atId||null}));
  await q(sb.from('produtos').update({qtd:Math.max(0, r3(p.qtd+qtd)), ...(extra.custo?{custo:extra.custo}:{})}).eq('id',p.id));
}
async function baixaEstoque(a){
  if(!D.config.baixaAuto) return;
  for(const p of D.produtos){ const c = Number(p.consumo?.[a.servicoId])||0; if(c>0) await movEstoque(p,'uso',-c,`${servico(a.servicoId).nome} · ${a.placa}`,null,{atId:a.id}); }
}
function alertaEstoque(){
  const b = produtosBaixos(); if(!b.length) return '';
  return `<div class="erro" style="margin-top:12px;cursor:pointer" onclick="subCaixa='estoque';irPara('caixa')" role="button">⚠ ${b.length} produto${b.length>1?'s':''} acabando: ${b.map(p=>esc(p.nome)).join(', ')}. Toque para ver o estoque.</div>`;
}
function telaEstoque(){
  const baixos = produtosBaixos(), valor = D.produtos.reduce((s,p)=>s+p.qtd*(p.custo||0),0);
  const mes = iso(HOJE).slice(0,7), usado = D.estoqueMov.filter(m=>m.tipo==='uso' && m.data.slice(0,7)===mes).reduce((s,m)=>{ const p = D.produtos.find(x=>x.id===m.produtoId); return s + (p? -m.qtd*(p.custo||0) : 0); },0);
  let h = `<div style="margin-top:18px"><h1>Caixa</h1><p class="sub">Produtos, compras e consumo.</p></div>${abasCaixa()}
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><b>${D.produtos.length}</b><span>produtos</span></div>
      <div class="kpi" style="border-color:${baixos.length?'#8a2424':'var(--linha)'}"><b class="${baixos.length?'sai':''}">${baixos.length}</b><span>abaixo do mínimo</span></div>
      <div class="kpi"><b>${brl(valor)}</b><span>parado em estoque</span></div>
      <div class="kpi"><b>${brl(usado)}</b><span>gasto em produto no mês</span></div>
    </div>
    <div class="grade" style="grid-template-columns:1fr 1fr;margin-top:12px">
      <button class="btn peq" onclick="editarProduto()"><span>+ Novo produto</span></button>
      <a class="btn sec peq" style="text-decoration:none" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?text=${encodeURIComponent('Lista de compras Vizzani:\n'+(baixos.length?baixos:D.produtos).map(p=>'- '+p.nome+' (tenho '+fmtQtd(p)+', mínimo '+fmtQtd(p,p.min)+')').join('\n'))}"><span>Lista de compras</span></a>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" ${D.config.baixaAuto?'checked':''} onchange="salvarConfig({baixa_auto_estoque:this.checked})"> Dar baixa sozinho ao entregar o carro (pelo consumo de cada serviço)</label>
    <div class="traco">PRODUTOS</div>`;
  if(!D.produtos.length) h += `<div class="painel vazio">Nenhum produto cadastrado.</div>`;
  [...D.produtos].sort((a,b)=>(a.qtd<=a.min?0:1)-(b.qtd<=b.min?0:1) || a.nome.localeCompare(b.nome)).forEach(p=>{
    const baixo = p.qtd<=p.min, pct = Math.min(100, p.qtd/Math.max(p.min*2,0.001)*100);
    const cons = Object.entries(p.consumo||{}).filter(([,q])=>q>0).map(([sid,q])=>`${servico(sid)?.nome||sid}: ${fmtQtd(p,q)}`).join(' · ');
    h += `<div class="painel"${baixo?' style="border-color:#8a2424"':''}><div class="linha entre"><b>${esc(p.nome)}</b>${baixo?'<span class="selo vermelho">⚠ acabando</span>':'<span class="selo verde">ok</span>'}</div>
      <div class="linha entre" style="margin-top:6px"><span class="valor">${fmtQtd(p)}</span><span class="mudo pequeno">mínimo ${fmtQtd(p,p.min)}${p.custo?' · '+brl(p.custo)+'/'+p.un:''}</span></div>
      <div class="barra"><i style="width:${pct}%;${baixo?'background:var(--erro)':''}"></i></div>
      ${cons?`<div class="mudo pequeno">Gasta por serviço: ${esc(cons)}</div>`:''}
      <div class="acoes"><button class="btn peq" onclick="abrirCompra('${p.id}')"><span>+ Compra</span></button><button class="btn sec peq" onclick="abrirUso('${p.id}')"><span>− Uso/perda</span></button><button class="btn sec peq" onclick="editarProduto('${p.id}')"><span>Editar</span></button></div></div>`;
  });
  const ult = [...D.estoqueMov].sort((a,b)=>b.quando.localeCompare(a.quando)).slice(0,12);
  if(ult.length) h += `<div class="traco">ÚLTIMAS MOVIMENTAÇÕES</div><div class="painel">${ult.map(m=>{ const p = D.produtos.find(x=>x.id===m.produtoId); if(!p) return '';
    return `<div class="mov"><span class="hora" style="font-size:15px">${fmtData(m.data)}</span><div>${esc(p.nome)}<div class="mudo pequeno">${{compra:'Compra',uso:'Uso',perda:'Perda',ajuste:'Ajuste de contagem'}[m.tipo]}${m.obs?' · '+esc(m.obs):''}</div></div><b class="${m.qtd>=0?'entra':'sai'}">${m.qtd>=0?'+':''}${fmtQtd(p,m.qtd)}</b></div>`; }).join('')}</div>`;
  return h;
}
function abrirCompra(pid){
  const p = D.produtos.find(x=>x.id===pid);
  abrirModal(`<h2 style="margin-top:0">Compra · ${esc(p.nome)}</h2><p class="sub">Hoje: ${fmtQtd(p)}</p>
    <div class="grade" style="grid-template-columns:1fr 1fr;margin-top:12px"><label class="campo">Quantidade (${p.un})<input id="ec-q" type="number" step="0.01" inputmode="decimal"></label><label class="campo">Valor total (R$)<input id="ec-v" type="number" step="0.01" inputmode="decimal"></label></div>
    <label class="campo">Fornecedor (opcional)<input id="ec-forn" list="lista-fornecedores" placeholder="Ex.: Distribuidora Brilho Car"></label>
    <datalist id="lista-fornecedores">${[...new Set(D.lancamentos.filter(l=>l.tipo==='saida' && l.pessoa).map(l=>l.pessoa))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
    <label class="campo">Detalhes (opcional)<input id="ec-det" placeholder="Ex.: nota fiscal 1234, galão de 5 L"></label>
    <label class="campo">Forma de pagamento<select id="ec-f">${['Pix','Dinheiro','Cartão','Boleto'].map(c=>`<option>${c}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" id="ec-cx" checked> Lançar como despesa no Caixa (categoria Produtos)</label>
    <button class="btn bloco" onclick="salvarCompra('${pid}')"><span>Registrar compra</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function salvarCompra(pid){
  const p = D.produtos.find(x=>x.id===pid), qt = Number(document.getElementById('ec-q').value), v = Number(document.getElementById('ec-v').value)||0;
  if(!(qt>0)) return aviso('Informe a quantidade comprada.');
  const noCaixa = v>0 && document.getElementById('ec-cx').checked, forma = document.getElementById('ec-f').value;
  const forn = document.getElementById('ec-forn').value.trim(), det = document.getElementById('ec-det').value.trim();
  const detalhes = [`${fmtQtd(p,qt)} de ${p.nome}`, v?`${brl(Math.round(v/qt*100)/100)}/${p.un}`:'', det].filter(Boolean).join(' · ');
  fecharModal();
  return acao(async()=>{
    await movEstoque(p,'compra',qt,[v?brl(v):'', forn].filter(Boolean).join(' · '),v,{custo: v>0 ? Math.round(v/qt*100)/100 : null});
    if(noCaixa) await q(sb.from('lancamentos').insert({data:iso(HOJE), tipo:'saida', descricao:`${p.nome} (${fmtQtd(p,qt)})`, categoria:'Produtos', valor:v, forma, pessoa:forn||null, detalhes}));
  }, 'Compra registrada.');
}
function abrirUso(pid){
  const p = D.produtos.find(x=>x.id===pid);
  abrirModal(`<h2 style="margin-top:0">${esc(p.nome)}</h2><p class="sub">Hoje: ${fmtQtd(p)}</p>
    <label class="campo" style="margin-top:12px">O que aconteceu?<select id="eu-t" onchange="document.getElementById('eu-rot').textContent=this.value==='ajuste'?'Quantidade contada agora (${p.un})':'Quantidade (${p.un})'"><option value="uso">Usei fora de um serviço</option><option value="perda">Perdeu, vazou ou venceu</option><option value="ajuste">Contei e o número é outro</option></select></label>
    <label class="campo"><span id="eu-rot">Quantidade (${p.un})</span><input id="eu-q" type="number" step="0.01" inputmode="decimal"></label>
    <label class="campo">Observação (opcional)<input id="eu-o"></label>
    <button class="btn bloco" onclick="salvarUso('${pid}')"><span>Salvar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function salvarUso(pid){
  const p = D.produtos.find(x=>x.id===pid), t = document.getElementById('eu-t').value, qt = Number(document.getElementById('eu-q').value), obs = document.getElementById('eu-o').value.trim();
  if(!(qt>=0) || document.getElementById('eu-q').value==='') return aviso('Informe a quantidade.');
  if(t!=='ajuste' && !(qt>0)) return aviso('Informe a quantidade.');
  fecharModal();
  return acao(()=> t==='ajuste' ? movEstoque(p,'ajuste',qt-p.qtd,obs) : movEstoque(p,t,-qt,obs), 'Estoque atualizado.');
}
function editarProduto(pid){
  const p = pid ? D.produtos.find(x=>x.id===pid) : {nome:'', un:'L', qtd:0, min:1, custo:0, consumo:{}};
  abrirModal(`<h2 style="margin-top:0">${pid?'Editar produto':'Novo produto'}</h2>
    <label class="campo">Nome<input id="ep-n" value="${esc(p.nome)}" placeholder="Ex.: Shampoo automotivo"></label>
    <div class="grade" style="grid-template-columns:1fr 1fr 1fr">
      <label class="campo">Unidade<select id="ep-u">${['L','ml','kg','g','un'].map(u=>`<option ${p.un===u?'selected':''}>${u}</option>`).join('')}</select></label>
      <label class="campo">Mínimo<input id="ep-m" type="number" step="0.01" value="${p.min}"></label>
      <label class="campo">${pid?'Custo/un':'Tenho hoje'}<input id="ep-x" type="number" step="0.01" value="${pid?p.custo:''}"></label>
    </div>
    <div class="traco">QUANTO GASTA POR SERVIÇO</div><p class="mudo pequeno" style="margin-top:-4px">Deixe vazio se o serviço não usa este produto.</p>
    <table class="tabela">${D.servicos.map(s=>`<tr><td>${esc(s.nome)}</td><td><input class="ep-c" data-sid="${s.id}" type="number" step="0.01" inputmode="decimal" value="${p.consumo?.[s.id]||''}" aria-label="Consumo em ${esc(s.nome)}"></td></tr>`).join('')}</table>
    <button class="btn bloco" style="margin-top:12px" onclick="salvarProduto('${pid||''}')"><span>Salvar</span></button>
    ${pid?`<button class="btn sec bloco" style="margin-top:8px" onclick="if(confirm('Excluir ${esc(p.nome)} do estoque?')){fecharModal();acao(()=>q(sb.from('produtos').update({ativo:false}).eq('id','${pid}')),'Produto excluído.')}"><span>Excluir produto</span></button>`:''}
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function salvarProduto(pid){
  const nome = document.getElementById('ep-n').value.trim(); if(nome.length<2) return aviso('Informe o nome do produto.');
  const consumo = {}; document.querySelectorAll('.ep-c').forEach(i=>{ const v = Number(i.value); if(v>0) consumo[i.dataset.sid] = v; });
  const un = document.getElementById('ep-u').value, min = Math.max(0,Number(document.getElementById('ep-m').value)||0), x = Number(document.getElementById('ep-x').value)||0;
  fecharModal();
  return acao(async()=>{
    let id = pid;
    if(pid) await q(sb.from('produtos').update({nome, unidade:un, minimo:min, custo:x}).eq('id',pid));
    else {
      [{id}] = await q(sb.from('produtos').insert({nome, unidade:un, minimo:min, qtd:0}).select('id'));
      if(x>0) await movEstoque({id, qtd:0}, 'ajuste', x, 'estoque inicial');
    }
    // consumo por serviço: substitui a lista inteira
    await q(sb.from('produto_consumo').delete().eq('produto_id', id));
    const linhas = Object.entries(consumo).map(([servico_id, qtd])=>({produto_id:id, servico_id, qtd}));
    if(linhas.length) await q(sb.from('produto_consumo').insert(linhas));
  }, 'Produto salvo.');
}

/* ---- Balcão: tudo começa pela placa ---- */
let buscaPlaca = '', novoCad = null;
function telaBalcao(){
  let h = `<div style="margin-top:18px"><h1>Balcão</h1><p class="sub">Digite a placa. O cliente não precisa ter o app instalado.</p></div>
    <div class="painel" style="margin-top:16px"><label class="campo" style="margin:0">Placa
      <input class="busca-placa" id="placaIn" maxlength="7" placeholder="ABC1D23" value="${esc(buscaPlaca)}" oninput="buscaPlaca=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'');this.value=buscaPlaca;if(buscaPlaca.length===7){novoCad=null;render();document.getElementById('placaIn').focus()}"></label>
    </div>` + painelPendencias();
  if(buscaPlaca.length<7){
    const recentes = [...new Set([...D.at].sort((a,b)=>(b.data+b.hora).localeCompare(a.data+a.hora)).map(a=>a.placa))].slice(0,6);
    if(recentes.length) h += `<div class="traco">ATENDIDOS POR ÚLTIMO</div><div class="chips">${recentes.map(p=>`<button class="chip" onclick="buscaPlaca='${p}';render()">${placaHTML(p,true)}</button>`).join('')}</div>`;
    return h;
  }
  if(!PLACA_RE.test(buscaPlaca)) return h + `<div class="erro" style="margin-top:12px">Placa inválida. Use o formato Mercosul (ABC1D23) ou o antigo (ABC1234).</div>`;
  const v = veiculo(buscaPlaca);
  if(!v) return h + telaCadastroRapido();
  const c = cliente(v.clienteId), lista = entreguesDe(v.placa), total = lista.reduce((s,a)=>s+a.valor,0);
  const ultimo = id => lista.find(a=>a.servicoId===id);
  const garantia = garantiaChuva(v.placa);
  h += `<div class="traco">FICHA DO VEÍCULO</div><div class="painel">
    <div class="linha entre">${placaHTML(v.placa)}<div style="text-align:right"><b>${esc(v.modelo)}</b><div class="mudo pequeno">${PORTES[v.porte]}</div></div></div>
    <div class="linha entre" style="margin-top:14px"><div><b>${esc(c.nome)}</b><div class="mudo pequeno">${fmtFone(c.fone)}</div></div>${noClube(c.id)?'<span class="selo azul">Clube</span>':''}</div>
    <div class="kpis" style="margin-top:12px"><div class="kpi"><b>${lista.length}</b><span>serviços</span></div><div class="kpi"><b>${brl(total).replace('R$ ','')}</b><span>total gasto (R$)</span></div></div>
    <table class="tabela" style="margin-top:10px"><tr><th>Último</th><th>Data</th></tr>
      ${[['Lavagem',ultimaLavagem(v.placa)],['Higienização',ultimo('higien')],['Polimento',ultimo('polimento')],['Vitrificação',ultimo('vitri')]].map(([n,a])=>`<tr><td>${n}</td><td>${a?fmtData(a.data)+' <span class="mudo">('+diasEntre(a.data,iso(HOJE))+(diasEntre(a.data,iso(HOJE))===1?' dia)':' dias)')+'</span>':'<span class="mudo">nunca</span>'}</td></tr>`).join('')}
    </table>
    <p class="mudo pequeno">Pontos: ${pontosDe(c.id)}${pontosDe(c.id)>=D.config.pontosResgate?' · tem lavagem grátis para usar':''} · ${c.temLogin?'usa o app':'ainda não criou senha no app'}${c.consente?'':' · não autorizou mensagens'}</p>
    <div class="grade" style="grid-template-columns:1fr 1fr;margin-top:6px">
      <button class="btn sec peq" onclick="editarCliente('${c.id}')"><span>Editar cliente</span></button>
      <button class="btn sec peq" onclick="transferirVeiculo('${v.placa}')"><span>Transferir carro</span></button>
    </div>
    ${c.temLogin?`<button class="link" onclick="liberarSenha('${c.id}')">Cliente esqueceu a senha</button>`:''}
  </div>
  ${clubeBalcao(c, v)}`;
  const comFotos = D.at.filter(a=>a.placa===v.placa && a.vistoria).sort((a,b)=>(b.data+b.hora).localeCompare(a.data+a.hora)).slice(0,3);
  if(comFotos.length){
    h += `<div class="traco">VISTORIAS DE ENTRADA</div><div class="painel">${comFotos.map(a=>`<div class="fila" style="grid-template-columns:52px 1fr auto"><span class="hora">${fmtData(a.data)}</span><div class="pequeno">${a.vistoria.fotos.length?a.vistoria.fotos.length+' foto'+(a.vistoria.fotos.length===1?'':'s'):'fotos expiradas'} · ${a.vistoria.avarias.length?esc(a.vistoria.avarias.join(', ')):'sem avarias aparentes'}</div><button class="btn sec peq" onclick="verVistoria('${a.id}')"><span>Ver</span></button></div>`).join('')}</div>`;
  }
  if(garantia) h += `<div class="painel" style="border-color:#2a45b8"><b>☔ Garantia de chuva válida</b><p class="sub">Lavou em ${fmtData(garantia.data)}. Se choveu, a relavagem sai de graça.</p><button class="btn bloco" style="margin-top:10px" onclick="atenderAgora('${v.placa}','${garantia.servicoId}',true)"><span>Fazer relavagem de chuva</span></button></div>`;
  const servs = D.servicos.filter(s=>s.precos[v.porte]!=null);
  if(noClube(c.id)){
    const lav = servs.filter(s=>s.noClube), el = lav.length ? clubeElegivel(c.id, lav[0].id, iso(HOJE)) : {ok:false, motivo:'Nenhum serviço do Clube para este tipo de veículo.'};
    h += `<div class="traco">PELO CLUBE</div>` + (el.ok
      ? `<p class="mudo pequeno" style="margin-top:-4px">Sem cobrança · restam ${el.restam} de ${D.config.clubeLavagens} em ${el.mes}${el.atraso?` · <span class="sai">mensalidade atrasada há ${el.atraso} dia${el.atraso>1?'s':''}</span>`:''}</p>`
        + lav.map(s=>`<button class="servico" style="border-color:#2a45b8" onclick="atenderAgora('${v.placa}','${s.id}',false,true)"><b>${esc(s.nome)}</b><span class="selo azul">Incluso no Clube</span></button>`).join('')
      : `<p class="mudo pequeno" style="margin-top:-4px">Hoje não dá para usar o Clube: ${esc(el.motivo)} Os serviços abaixo são cobrados.</p>`);
  }
  h += `<div class="traco">ATENDER AGORA${noClube(c.id)?' (COBRADO)':''}</div>${servs.map(s=>`<button class="servico" onclick="atenderAgora('${v.placa}','${s.id}',false)"><b>${esc(s.nome)}</b><span class="valor">${brl(s.precos[v.porte])}</span></button>`).join('')}`;
  return h;
}
function telaCadastroRapido(){
  novoCad = novoCad || {modelo:'',porte:'carro',nome:'',fone:'',consente:false,erro:''};
  return `<div class="traco">PLACA NOVA</div><div class="painel">
    <p class="sub" style="margin-top:0">Primeira vez da ${esc(buscaPlaca)}. Cadastro em 20 segundos:</p>
    ${novoCad.erro?`<div class="erro" style="margin-top:10px">${novoCad.erro}</div>`:''}
    <label class="campo">Modelo<input value="${esc(novoCad.modelo)}" oninput="novoCad.modelo=this.value" placeholder="Ex.: Fiat Argo"></label>
    <label class="campo">Porte<select onchange="novoCad.porte=this.value">${Object.entries(PORTES).map(([k,n])=>`<option value="${k}" ${novoCad.porte===k?'selected':''}>${n}</option>`).join('')}</select></label>
    <label class="campo">Nome do cliente<input value="${esc(novoCad.nome)}" oninput="novoCad.nome=this.value"></label>
    <label class="campo">WhatsApp<input inputmode="tel" value="${esc(novoCad.fone)}" oninput="novoCad.fone=this.value.replace(/\\D/g,'')" placeholder="34999998888"></label>
    <label class="check"><input type="checkbox" ${novoCad.consente?'checked':''} onchange="novoCad.consente=this.checked"> Cliente aceita receber lembretes e ofertas pelo WhatsApp</label>
    <button class="btn bloco" onclick="salvarCadastro()"><span>Cadastrar veículo</span></button>
  </div>`;
}
async function salvarCadastro(){
  const fone = soDig(novoCad.fone), modelo = novoCad.modelo.trim(), nome = novoCad.nome.trim();
  const erro = !modelo ? 'Informe o modelo do veículo.' : nome.length<2 ? 'Informe o nome do cliente.' : !foneValido(fone) ? 'WhatsApp inválido. Use DDD + número com 9 dígitos, ex.: 34 99999-8888.' : '';
  if(erro){ novoCad.erro = erro; render(); return; }
  const existente = D.clientes.find(x=>x.fone===fone);
  if(existente && !confirm(`Esse WhatsApp já é de ${existente.nome}. Adicionar o ${modelo} à ficha dele(a)?`)) return;
  const dados = {...novoCad}, placa = buscaPlaca;
  const ok = await acao(async()=>{
    let cid = existente?.id;
    if(!cid) [{id:cid}] = await q(sb.from('clientes').insert({nome, fone, consente:dados.consente}).select('id'));
    await q(sb.from('veiculos').insert({placa, modelo, porte:dados.porte, cliente_id:cid}));
  }, 'Veículo cadastrado.');
  if(ok!==false){ novoCad=null; render(); }
}
async function atenderAgora(placa,sid,chuva,clube=false){
  const v = veiculo(placa), s = servico(sid), agora = new Date(), preco = s.precos[v.porte];
  const hora = String(agora.getHours()).padStart(2,'0')+':'+String(agora.getMinutes()).padStart(2,'0');
  if(clube && !clubeElegivel(v.clienteId, sid, iso(HOJE)).ok) return aviso('Hoje não dá para usar o Clube neste serviço.');
  const semCobranca = chuva || clube;
  const id = await acao(async()=>{
    const [n] = await q(sb.from('atendimentos').insert({placa, servico_id:sid, data:iso(HOJE), hora, status:'agendado', cliente_id:v.clienteId,
      valor:semCobranca?0:preco, valor_tabela:preco, pago:!!chuva, chuva:!!chuva, clube:!!clube, origem:'balcao'}).select('id'));
    return n.id;
  });
  if(id===false) return;
  buscaPlaca=''; irPara('hoje'); abrirVistoria(id);
}
/* Clube no balcão: o cliente pede pelo app (ou pessoalmente) e o dono ativa ao receber a mensalidade */
function clubeBalcao(c, v){
  const cl = D.clube[c.id], porte = cl?.porte || (v.porte);
  if(cl?.ativo) return `<div class="painel" style="border-color:#2a45b8"><div class="linha entre"><b>Clube ativo</b><span class="selo azul">desde ${fmtData(cl.desde)}</span></div>
    <p class="mudo pequeno" style="margin:6px 0 10px">Lavagens usadas/agendadas: ${resumoClube(c.id)} · ${brl(D.config.clubePrecos[porte])}/mês (${PORTES[porte]})</p>
    <div class="grade" style="grid-template-columns:1fr 1fr"><button class="btn peq" onclick="abrirMensalidade('${c.id}','${porte}',false)"><span>Registrar mensalidade</span></button><button class="btn sec peq" onclick="encerrarClube('${c.id}')"><span>Encerrar</span></button></div></div>`;
  if(cl?.pendente) return `<div class="info"><b>${esc(c.nome.split(' ')[0])} pediu para assinar o Clube.</b><br>Ative quando receber a 1ª mensalidade (${brl(D.config.clubePrecos[porte])}).
    <button class="btn bloco" style="margin-top:10px" onclick="abrirMensalidade('${c.id}','${porte}',true)"><span>Ativar Clube</span></button></div>`;
  return `<div style="text-align:right"><button class="link" onclick="abrirMensalidade('${c.id}','${porte}',true)">Assinar o Clube para este cliente</button></div>`;
}
function abrirMensalidade(cid, porte, ativar){
  const c = cliente(cid), preco = D.config.clubePrecos[porte], s = statusClube(cid);
  abrirModal(`<h2 style="margin-top:0">${ativar?'Ativar Clube':'Mensalidade do Clube'}</h2><p class="sub">${esc(c.nome)} · ${PORTES[porte]} · ${brl(preco)}/mês</p>
    ${!ativar && s?.tipo==='aberto'?`<div class="${s.atraso>0?'erro':'info'}" style="margin-top:10px">Em aberto desde ${fmtData(s.vencimento)}${s.atraso>0?` (${s.atraso} dia${s.atraso>1?'s':''})`:''}.</div>`:''}
    ${!ativar && s?.tipo==='em_dia'?`<div class="info" style="margin-top:10px">Em dia até ${fmtData(s.proximo)}. Este pagamento adianta o próximo mês.</div>`:''}
    <label class="campo" style="margin-top:12px">Quantos meses<select id="ms-m" onchange="document.getElementById('ms-v').value=(${preco}*this.value).toFixed(2)">${[1,2,3,6,12].map(m=>`<option value="${m}">${m} ${m===1?'mês':'meses'}</option>`).join('')}</select></label>
    <label class="campo">Valor recebido (R$)<input id="ms-v" type="number" step="0.01" value="${preco}"></label>
    <label class="campo">Forma<select id="ms-f">${['Pix','Cartão','Dinheiro'].map(f=>`<option>${f}</option>`).join('')}</select></label>
    <button class="btn bloco" onclick="salvarMensalidade('${cid}','${porte}',${ativar})"><span>${ativar?'Ativar e lançar no caixa':'Lançar no caixa'}</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function salvarMensalidade(cid, porte, ativar){
  const valor = Number(document.getElementById('ms-v').value), forma = document.getElementById('ms-f').value, c = cliente(cid);
  const meses = Number(document.getElementById('ms-m').value)||1;
  if(!(valor>0)) return aviso('Informe o valor recebido.');
  // Regras contra registro duplicado
  const hoje = D.lancamentos.filter(l=>l.tipo==='entrada' && l.cat==='Clube' && l.clienteId===cid && l.data===iso(HOJE));
  if(hoje.length && !confirm(`Já foi registrado ${hoje.length===1?'um pagamento':hoje.length+' pagamentos'} do Clube de ${c.nome} hoje (${hoje.map(l=>brl(l.valor)).join(', ')}).\n\nRegistrar OUTRO pagamento mesmo assim?`)) return;
  const s = statusClube(cid);
  if(!ativar && s?.tipo==='em_dia' && diasEntre(iso(HOJE), s.proximo) > 7){
    const preco = D.config.clubePrecos[porte] || 1, novos = Math.max(1, Math.round(valor/preco));
    const ini = dataDe(s.desde), nova = venceNoMes(ini.getFullYear(), ini.getMonth()+s.meses+novos, ini.getDate());
    if(!confirm(`${c.nome} já está em dia até ${fmtData(s.proximo)}.\n\nEste pagamento vai adiantar a próxima mensalidade para ${fmtData(iso(nova))}. Confirmar?`)) return;
  }
  fecharModal();
  return acao(async()=>{
    if(ativar){
      await q(sb.from('clube_assinaturas').upsert({cliente_id:cid, porte, desde:iso(HOJE), ativo:true, cancelado_em:null}));
      await enviarRecado(cid, null, 'Sua assinatura do Clube Vizzani está ativa! Agende suas lavagens pelo app, sem sinal. 🎉');
    }
    await q(sb.from('lancamentos').insert({data:iso(HOJE), tipo:'entrada', categoria:'Clube', descricao:'Mensalidade Clube', valor, forma,
      pessoa:c.nome, cliente_id:cid, detalhes:`${PORTES[porte]} · ${meses} ${meses===1?'mês':'meses'} · pago em ${new Date().toLocaleDateString('pt-BR')}`}));
  }, ativar?'Clube ativado.':'Mensalidade lançada no caixa.');
}
function encerrarClube(cid){
  if(!confirm('Encerrar a assinatura do Clube deste cliente?')) return;
  return acao(()=>q(sb.from('clube_assinaturas').update({ativo:false, cancelado_em:new Date().toISOString()}).eq('cliente_id',cid)), 'Assinatura encerrada.');
}

/* ---- Retorno: quem sumiu ---- */
/* ================= CLIENTES: lista com filtros, ficha completa, Clube e Retorno ================= */
let subCli = 'lista', filtroCli = 'todos', ordemCli = 'recente', buscaCli = '';
const abasCli = () => `<div class="abas-entrar" style="margin:16px 0 0;grid-template-columns:1fr 1fr 1fr">${[['lista','Clientes'],['clube','Clube'],['retorno','Retorno']].map(([k,n])=>`<button class="${subCli===k?'on':''}" onclick="subCli='${k}';render()">${n}${k==='clube'&&clubeAtencao()?' ⚠':''}</button>`).join('')}</div>`;

// Mensalidade do Clube: vence todo mês no mesmo dia em que a assinatura começou.
// Cada pagamento cobre 1 mês (ou vários, se o valor pago for múltiplo da mensalidade), contando a partir do início.
const venceNoMes = (ano, mes, dia) => new Date(ano, mes, Math.min(dia, new Date(ano, mes+1, 0).getDate()));
function statusClube(cid){
  const cl = D.clube[cid]; if(!cl) return null;
  if(cl.pendente) return {tipo:'pendente', porte:cl.porte};
  if(!cl.ativo) return {tipo:'encerrado', porte:cl.porte};
  const ini = dataDe(cl.desde), preco = D.config.clubePrecos[cl.porte] || 1;
  const pags = D.lancamentos.filter(l=>l.tipo==='entrada' && l.cat==='Clube' && l.clienteId===cid && l.data>=iso(addDias(ini,-7))).sort((a,b)=>b.data.localeCompare(a.data));
  const meses = pags.reduce((s,l)=>s + Math.max(1, Math.round(l.valor/preco)), 0);
  const cobertoAte = venceNoMes(ini.getFullYear(), ini.getMonth()+meses, ini.getDate());   // próxima mensalidade a pagar
  return cobertoAte > HOJE
    ? {tipo:'em_dia', porte:cl.porte, desde:cl.desde, proximo:iso(cobertoAte), ultimo:pags[0], meses}
    : {tipo:'aberto', porte:cl.porte, desde:cl.desde, vencimento:iso(cobertoAte), atraso:diasEntre(iso(cobertoAte), iso(HOJE)), ultimo:pags[0], meses};
}
const clubeAtencao = () => Object.keys(D.clube).filter(cid=>{ const s = statusClube(cid); return s && (s.tipo==='pendente' || (s.tipo==='aberto' && s.atraso>0)); }).length;

function resumoCliente(c){
  const vs = veiculosDe(c.id), ats = D.at.filter(a=>donoAt(a)===c.id);
  const entregues = ats.filter(a=>a.status==='entregue').sort((a,b)=>b.data.localeCompare(a.data));
  const avulsas = D.lancamentos.filter(l=>l.tipo==='entrada' && l.clienteId===c.id);
  const total = entregues.reduce((s,a)=>s+a.valor,0) + avulsas.reduce((s,l)=>s+l.valor,0);
  const ult = entregues[0];
  return {vs, ats, entregues, avulsas, total, ult, dias: ult ? diasEntre(ult.data, iso(HOJE)) : null,
    proximos: ats.filter(a=>a.data>=iso(HOJE) && a.status==='agendado').sort((a,b)=>(a.data+a.hora).localeCompare(b.data+b.hora)),
    pontos: pontosDe(c.id), clube: statusClube(c.id)};
}
const FILTROS_CLI = {
  todos:  ['Todos',        ()=>true],
  clube:  ['Clube',        (c,r)=>r.clube && ['em_dia','aberto'].includes(r.clube.tipo)],
  app:    ['Usam o app',   c=>c.temLogin],
  semapp: ['Sem app',      c=>!c.temLogin],
  pontos: ['Com lavagem grátis', (c,r)=>r.pontos>=D.config.pontosResgate],
  novos:  ['Novos (30 dias)', c=>c.criadoEm && diasEntre(dataLocal(c.criadoEm), iso(HOJE))<=30],
  sumidos:['Sumidos 30+',  (c,r)=>r.dias!==null && r.dias>=30 && !r.proximos.length],
  agenda: ['Com horário marcado', (c,r)=>r.proximos.length>0],
  semmsg: ['Não aceitam mensagens', c=>!c.consente],
};
function telaClientes(){
  if(aba==='retorno') aba='clientes', subCli='retorno';
  if(subCli==='retorno') return telaRetorno();
  if(subCli==='clube') return telaClubeDono();
  return `<div style="margin-top:18px"><h1>Clientes</h1><p class="sub">${D.clientes.length} cadastrados. Toque num cliente para ver a ficha completa.</p></div>${abasCli()}
    <div class="painel" style="margin-top:12px"><label class="campo" style="margin:0">Buscar<input id="cli-busca" value="${esc(buscaCli)}" placeholder="Nome, WhatsApp ou placa" oninput="buscaCli=this.value;atualizarListaCli()"></label></div>
    <div id="cli-res">${listaClientesHTML()}</div>`;
}
function atualizarListaCli(){ const el = document.getElementById('cli-res'); if(el) el.innerHTML = listaClientesHTML(); }
function listaClientesHTML(){
  const termo = buscaCli.trim().toLowerCase(), dig = soDig(buscaCli), placa = limparPlaca(buscaCli);
  const base = D.clientes.map(c=>({c, r:resumoCliente(c)})).filter(({c,r})=>!termo || c.nome.toLowerCase().includes(termo) || (dig.length>=4 && c.fone.includes(dig)) || (placa.length>=3 && r.vs.some(v=>v.placa.includes(placa))));
  const cont = k => base.filter(({c,r})=>FILTROS_CLI[k][1](c,r)).length;
  let lista = base.filter(({c,r})=>FILTROS_CLI[filtroCli][1](c,r));
  const ord = {recente:(a,b)=>(b.r.ult?.data||'').localeCompare(a.r.ult?.data||''), nome:(a,b)=>a.c.nome.localeCompare(b.c.nome,'pt-BR'), gasto:(a,b)=>b.r.total-a.r.total}[ordemCli];
  lista.sort(ord);
  let h = `<div class="chips" style="margin-top:12px">${Object.entries(FILTROS_CLI).map(([k,[n]])=>`<button class="chip ${filtroCli===k?'on':''}" onclick="filtroCli='${k}';atualizarListaCli()">${n}<b>${cont(k)}</b></button>`).join('')}</div>
    <div class="linha entre" style="margin:8px 0"><span class="mudo pequeno">${lista.length} cliente${lista.length===1?'':'s'}</span>
      <select onchange="ordemCli=this.value;atualizarListaCli()" style="background:var(--grafite);border:1px solid var(--linha);border-radius:8px;padding:6px 8px" aria-label="Ordenar">${[['recente','Último serviço'],['nome','Nome (A-Z)'],['gasto','Quem mais gastou']].map(([k,n])=>`<option value="${k}" ${ordemCli===k?'selected':''}>${n}</option>`).join('')}</select></div>
    <div class="painel">`;
  if(!lista.length) h += `<div class="vazio">Ninguém encontrado.</div>`;
  lista.slice(0,200).forEach(({c,r})=>{
    const cl = r.clube;
    const seloClube = !cl ? '' : cl.tipo==='em_dia' ? '<span class="selo azul">Clube</span>' : cl.tipo==='aberto' ? `<span class="selo ${cl.atraso>0?'vermelho':'amarelo'}">Clube ${cl.atraso>0?'atrasado':'vence hoje'}</span>` : cl.tipo==='pendente' ? '<span class="selo amarelo">pediu Clube</span>' : '';
    h += `<div class="fila" role="button" tabindex="0" style="cursor:pointer;grid-template-columns:1fr auto" onclick="abrirCliente('${c.id}')">
      <div><b>${esc(c.nome)}</b> ${seloClube} ${c.temLogin?'<span class="selo">app</span>':''}
        <div class="mudo pequeno">${fmtFone(c.fone)} · ${r.vs.map(v=>esc(v.placa)).join(', ')||'sem carro'}</div>
        <div class="mudo pequeno">${r.ult?`último: ${esc(servico(r.ult.servicoId)?.nome||'')} há ${r.dias} dia${r.dias===1?'':'s'}`:'nenhum serviço ainda'}${r.proximos.length?` · marcado ${fmtData(r.proximos[0].data)}`:''}</div></div>
      <div style="text-align:right"><b>${brl(r.total)}</b><div class="mudo pequeno">${r.entregues.length} serv.</div></div></div>`;
  });
  if(lista.length>200) h += `<p class="mudo pequeno">Mostrando 200 de ${lista.length}. Use a busca para achar os outros.</p>`;
  return h + `</div>`;
}
/* Ficha completa do cliente */
function abrirCliente(cid){
  const c = cliente(cid), r = resumoCliente(c), cl = r.clube;
  const linha = (rot, val) => val ? `<tr><td class="mudo">${rot}</td><td>${val}</td></tr>` : '';
  const clubeHTML = !cl ? `<button class="link" onclick="fecharModal();abrirMensalidade('${cid}','${r.vs.map(v=>v.porte).find(p=>p!=='moto')||r.vs[0]?.porte||'carro'}',true)">Assinar o Clube para este cliente</button>`
    : cl.tipo==='pendente' ? `<div class="info">Pediu para assinar o Clube.<button class="btn bloco" style="margin-top:8px" onclick="fecharModal();abrirMensalidade('${cid}','${cl.porte}',true)"><span>Ativar Clube</span></button></div>`
    : cl.tipo==='encerrado' ? `<p class="mudo pequeno">Clube encerrado. <button class="link" onclick="fecharModal();abrirMensalidade('${cid}','${cl.porte}',true)">Reativar</button></p>`
    : `<div class="${cl.tipo==='aberto'&&cl.atraso>0?'erro':'info'}"><b>Clube ${PORTES[cl.porte]} · ${brl(D.config.clubePrecos[cl.porte])}/mês</b><br>
        ${cl.tipo==='em_dia'?`Em dia. Próxima mensalidade: ${fmtData(cl.proximo)}.`:cl.atraso>0?`Mensalidade de ${fmtData(cl.vencimento)} em aberto há ${cl.atraso} dia${cl.atraso>1?'s':''}.`:'Mensalidade vence hoje.'}
        ${cl.ultimo?`<br><span class="pequeno">Último pagamento: ${fmtData(cl.ultimo.data)} · ${brl(cl.ultimo.valor)} · ${esc(cl.ultimo.forma)}</span>`:''}
        <br><span class="pequeno">Lavagens usadas/agendadas: ${resumoClube(cid)} · desde ${fmtData(cl.desde)}</span>
        ${pagamentosClubeHTML(cid)}
        <div class="acoes"><button class="btn peq" onclick="fecharModal();abrirMensalidade('${cid}','${cl.porte}',false)"><span>Registrar pagamento</span></button>${cl.tipo==='aberto'?`<a class="btn zap peq" style="text-decoration:none" target="_blank" rel="noopener" href="${linkZap(c.fone,msgCobrancaClube(c,cl))}"><span>Cobrar</span></a>`:''}<button class="btn sec peq" onclick="fecharModal();encerrarClube('${cid}')"><span>Encerrar</span></button></div></div>`;
  abrirModal(`<h2 style="margin-top:0">${esc(c.nome)}</h2>
    <table class="tabela">
      ${linha('WhatsApp', fmtFone(c.fone))}
      ${linha('App', c.temLogin?'usa o app':'ainda não entrou no app')}
      ${linha('Mensagens', c.consente?'aceita lembretes e ofertas':'não autorizou ofertas')}
      ${linha('Cliente desde', c.criadoEm?new Date(c.criadoEm).toLocaleDateString('pt-BR'):'')}
    </table>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><b>${brl(r.total)}</b><span>total gasto</span></div>
      <div class="kpi"><b>${r.entregues.length}</b><span>serviços</span></div>
      <div class="kpi"><b>${r.entregues.length?brl(r.entregues.reduce((s,a)=>s+a.valor,0)/r.entregues.length):'—'}</b><span>ticket médio</span></div>
      <div class="kpi"><b>${r.pontos}</b><span>pontos${r.pontos>=D.config.pontosResgate?' · tem lavagem grátis':''}</span></div>
    </div>
    <div class="traco">CLUBE</div>${clubeHTML}
    <div class="traco">CARROS</div>
    ${r.vs.length?r.vs.map(v=>`<div class="linha entre" style="margin-bottom:8px">${placaHTML(v.placa,true)}<span class="pequeno">${esc(v.modelo)} · ${PORTES[v.porte]}</span><button class="btn sec peq" onclick="fecharModal();buscaPlaca='${v.placa}';irPara('balcao')"><span>Ficha</span></button></div>`).join(''):'<p class="mudo pequeno">Nenhum carro na conta.</p>'}
    ${r.proximos.length?`<div class="traco">AGENDADO</div>${r.proximos.map(a=>`<p class="pequeno" style="margin:4px 0">${esc(descAt(a))} · ${esc(a.placa)}</p>`).join('')}`:''}
    <div class="traco">HISTÓRICO</div>
    ${r.entregues.length||r.avulsas.length?`<table class="tabela">${[...r.entregues.map(a=>({data:a.data, txt:esc(servico(a.servicoId)?.nome||'')+' · '+esc(a.placa)+(a.nota?' · '+'★'.repeat(a.nota):''), valor:a.valor})), ...r.avulsas.map(l=>({data:l.data, txt:esc(l.desc)+(l.detalhes?' · '+esc(l.detalhes):''), valor:l.valor}))]
      .sort((a,b)=>b.data.localeCompare(a.data)).slice(0,15).map(x=>`<tr><td class="mudo">${fmtData(x.data)}</td><td>${x.txt}</td><td style="text-align:right">${brl(x.valor)}</td></tr>`).join('')}</table>`:'<p class="mudo pequeno">Nenhum serviço ou compra ainda.</p>'}
    <div class="grade" style="grid-template-columns:1fr 1fr;margin-top:14px">
      <a class="btn zap peq" style="text-decoration:none" target="_blank" rel="noopener" href="${linkZap(c.fone,`Olá, ${c.nome.split(' ')[0]}! Aqui é da Vizzani Estética.`)}"><span>WhatsApp</span></a>
      <button class="btn sec peq" onclick="editarCliente('${cid}')"><span>Editar</span></button>
      ${r.vs.length?`<button class="btn peq" onclick="fecharModal();novoAgDono();novoAg.placa='${r.vs[0].placa}';desenharNovoAg()"><span>Agendar</span></button>`:''}
      ${c.temLogin?`<button class="btn sec peq" onclick="fecharModal();liberarSenha('${cid}')"><span>Liberar senha</span></button>`:''}
    </div>
    <button class="btn sec bloco" style="margin-top:10px" onclick="fecharModal()"><span>Fechar</span></button>`);
}
// Pagamentos do Clube na ficha, com "apagar" para corrigir registro feito por engano
function pagamentosClubeHTML(cid){
  const pags = D.lancamentos.filter(l=>l.tipo==='entrada' && l.cat==='Clube' && l.clienteId===cid).sort((a,b)=>b.data.localeCompare(a.data)).slice(0,6);
  if(!pags.length) return '';
  return `<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,.15);padding-top:6px"><span class="pequeno"><b>Pagamentos</b></span>
    ${pags.map(l=>`<div class="linha entre pequeno" style="margin-top:4px"><span>${fmtData(l.data)} · ${brl(l.valor)} · ${esc(l.forma)}</span><button class="link pequeno" style="padding:0" onclick="apagarPagamentoClube('${l.id}','${cid}')">apagar</button></div>`).join('')}</div>`;
}
async function apagarPagamentoClube(id, cid){
  const l = D.lancamentos.find(x=>x.id===id);
  if(!confirm(`Apagar o pagamento de ${brl(l.valor)} de ${fmtData(l.data)}? Ele sai do caixa e a mensalidade é recalculada.`)) return;
  fecharModal();
  if(await acao(()=>q(sb.from('lancamentos').delete().eq('id',id)), 'Pagamento apagado.') !== false) abrirCliente(cid);
}
const msgCobrancaClube = (c, cl) => `Olá, ${c.nome.split(' ')[0]}! Tudo bem? A mensalidade do Clube Vizzani (${brl(D.config.clubePrecos[cl.porte])}) venceu em ${fmtData(cl.vencimento)}. ${D.loja.pix?'Pode fazer o Pix para '+D.loja.pix+' ou':'Pode'} pagar aqui na loja. Qualquer dúvida é só chamar!`;
/* Clube: visão do dono (assinantes, quem pagou, quem está em aberto, pedidos) */
function telaClubeDono(){
  const todos = Object.keys(D.clube).map(cid=>({c:cliente(cid), s:statusClube(cid)})).filter(x=>x.c && x.s);
  const ativos = todos.filter(x=>['em_dia','aberto'].includes(x.s.tipo)), pendentes = todos.filter(x=>x.s.tipo==='pendente');
  const aberto = ativos.filter(x=>x.s.tipo==='aberto'), emDia = ativos.filter(x=>x.s.tipo==='em_dia');
  const previsto = ativos.reduce((s,x)=>s+D.config.clubePrecos[x.s.porte],0);
  const mes = iso(HOJE).slice(0,7), recebidoMes = D.lancamentos.filter(l=>l.tipo==='entrada' && l.cat==='Clube' && l.data.slice(0,7)===mes).reduce((s,l)=>s+l.valor,0);
  let h = `<div style="margin-top:18px"><h1>Clientes</h1><p class="sub">Assinaturas do Clube Vizzani.</p></div>${abasCli()}
    <div class="kpis" style="margin-top:12px">
      <div class="kpi destaque"><b>${ativos.length}</b><span>assinantes ativos · ${brl(previsto)}/mês previstos</span></div>
      <div class="kpi"><b class="entra">${emDia.length}</b><span>em dia</span></div>
      <div class="kpi" style="border-color:${aberto.some(x=>x.s.atraso>0)?'#8a2424':'var(--linha)'}"><b class="${aberto.length?'sai':''}">${aberto.length}</b><span>em aberto</span></div>
      <div class="kpi"><b>${brl(recebidoMes)}</b><span>recebido do Clube este mês</span></div>
      <div class="kpi"><b>${pendentes.length}</b><span>pedidos para ativar</span></div>
    </div>`;
  if(pendentes.length) h += `<div class="traco">PEDIRAM PARA ASSINAR</div><div class="painel">${pendentes.map(({c,s})=>`<div class="fila" style="grid-template-columns:1fr auto"><div><b>${esc(c.nome)}</b><div class="mudo pequeno">${PORTES[s.porte]} · ${brl(D.config.clubePrecos[s.porte])}/mês · ${fmtFone(c.fone)}</div></div><button class="btn peq" onclick="abrirMensalidade('${c.id}','${s.porte}',true)"><span>Ativar</span></button></div>`).join('')}</div>`;
  if(aberto.length) h += `<div class="traco">MENSALIDADE EM ABERTO</div><div class="painel">${aberto.sort((a,b)=>b.s.atraso-a.s.atraso).map(({c,s})=>`<div class="fila" style="grid-template-columns:1fr auto"><div role="button" style="cursor:pointer" onclick="abrirCliente('${c.id}')"><b>${esc(c.nome)}</b> <span class="selo ${s.atraso>0?'vermelho':'amarelo'}">${s.atraso>0?s.atraso+' dia'+(s.atraso>1?'s':'')+' de atraso':'vence hoje'}</span><div class="mudo pequeno">venceu ${fmtData(s.vencimento)} · ${brl(D.config.clubePrecos[s.porte])}${s.ultimo?' · último pgto '+fmtData(s.ultimo.data):''}</div></div>
      <div class="acoes" style="margin:0;justify-content:flex-end"><button class="btn peq" onclick="abrirMensalidade('${c.id}','${s.porte}',false)"><span>Recebi</span></button><a class="btn zap peq" style="text-decoration:none" target="_blank" rel="noopener" href="${linkZap(c.fone,msgCobrancaClube(c,s))}"><span>Cobrar</span></a></div></div>`).join('')}
    <p class="mudo pequeno">Muito atrasado? Abra a ficha e toque em "Encerrar": as lavagens incluídas param na hora.</p></div>`;
  h += `<div class="traco">EM DIA</div><div class="painel">${emDia.length?emDia.sort((a,b)=>a.s.proximo.localeCompare(b.s.proximo)).map(({c,s})=>`<div class="fila" role="button" style="cursor:pointer;grid-template-columns:1fr auto" onclick="abrirCliente('${c.id}')"><div><b>${esc(c.nome)}</b><div class="mudo pequeno">${PORTES[s.porte]} · lavagens ${resumoClube(c.id)}</div></div><div style="text-align:right" class="pequeno">próxima<br><b>${fmtData(s.proximo)}</b></div></div>`).join(''):'<div class="vazio">Nenhum assinante em dia.</div>'}</div>
    <p class="mudo pequeno">A mensalidade vence todo mês no mesmo dia em que a assinatura foi ativada. Pagamento feito até 7 dias antes já conta para o mês.</p>`;
  return h;
}

function clientesSumidos(){
  return D.clientes.map(c=>{
    const ult = D.at.filter(a=>a.status==='entregue' && donoAt(a)===c.id).sort((a,b)=>b.data.localeCompare(a.data))[0];
    const futuro = D.at.some(a=>a.data>=iso(HOJE) && ['agendado','recebido','pronto'].includes(a.status) && donoAt(a)===c.id);
    return ult && !futuro ? {c, ult, dias:diasEntre(ult.data,iso(HOJE))} : null;
  }).filter(Boolean).sort((a,b)=>b.dias-a.dias);
}
let faixa = 30;
function telaRetorno(){
  const todos = clientesSumidos();
  const cont = f => todos.filter(x=>x.dias>=f && (f===90 || x.dias < (f===30?60:90))).length;
  const lista = todos.filter(x=>x.dias>=faixa && (faixa===90 || x.dias<(faixa===30?60:90)));
  let h = `<div style="margin-top:18px"><h1>Clientes</h1><p class="sub">Quem não volta. Até 3 lembretes por cliente, só para quem autorizou.</p></div>${abasCli()}
  <div class="chips" style="margin-top:12px">${[30,60,90].map(f=>`<button class="chip ${faixa===f?'on':''}" onclick="faixa=${f};render()">${f===90?'90+ dias':f+'–'+(f===30?59:89)+' dias'}<b>${cont(f)}</b></button>`).join('')}</div>
  <div class="painel" style="margin-top:12px">`;
  if(!lista.length) h += `<div class="vazio">Ninguém nessa faixa. Bom sinal.</div>`;
  lista.forEach(({c,ult,dias})=>{
    const env = D.avisos[c.id]||[];
    const recente = env.length && diasEntre(env[env.length-1],iso(HOJE))<7;
    const v = veiculo(ult.placa);
    const msg = `Olá, ${c.nome.split(' ')[0]}! Faz ${dias} dias desde o último cuidado com o seu ${v.modelo} aqui na Vizzani. Temos horários esta semana. Quer agendar? 🚗`;
    let acao;
    if(!c.consente) acao = `<span class="selo vermelho">Sem autorização</span>`;
    else if(env.length>=3) acao = `<span class="selo">3 avisos enviados</span>`;
    else if(recente) acao = `<span class="selo amarelo">Avisado ${fmtData(env[env.length-1])}</span>`;
    else acao = `<a class="btn zap peq" style="text-decoration:none" target="_blank" rel="noopener" onclick="registrarAviso('${c.id}')" href="${linkZap(c.fone,msg)}"><span>Chamar</span></a>`;
    h += `<div class="fila"><span class="hora">${dias}d</span><div><b>${esc(c.nome)}</b><div class="mudo pequeno">${esc(v.modelo)} · último: ${esc(servico(ult.servicoId).nome)} em ${fmtData(ult.data)}</div>${env.length?`<div class="mudo pequeno">Avisos: ${env.length}/3</div>`:''}</div>${acao}</div>`;
  });
  h += `</div><p class="mudo pequeno">Depois de chamar, o cliente só aparece para novo aviso após 7 dias. Quando ele agenda, sai da lista sozinho.</p>`;
  return h;
}
function registrarAviso(cid){ setTimeout(()=>acao(()=>q(sb.from('avisos_retorno').insert({cliente_id:cid})))); }

/* ---- Ajustes ---- */
function telaAjustes(){
  let h = `<div style="margin-top:18px"><h1>Ajustes</h1><p class="sub">Preços por porte, capacidade e regras.</p></div>
  <div class="traco">TABELA DE PREÇOS</div><div class="painel rolagem"><table class="tabela"><tr><th>Serviço</th>${Object.values(PORTES).map(p=>`<th>${p}</th>`).join('')}</tr>
    ${D.servicos.map(s=>`<tr><td>${esc(s.nome)}</td>${Object.keys(PORTES).map(p=>s.precos[p]==null?'<td class="mudo">—</td>':`<td><input type="number" step="0.1" min="0" inputmode="decimal" value="${s.precos[p]}" onchange="salvarServico('${s.id}',{preco_${p}:Math.max(0,Number(this.value))})" aria-label="${esc(s.nome)} ${PORTES[p]}"></td>`).join('')}</tr>`).join('')}
  </table></div>
  <div class="traco">HORÁRIO DE FUNCIONAMENTO</div><div class="painel">
    <p class="mudo pequeno" style="margin-top:0">Os clientes só conseguem agendar dentro destes horários.</p>
    ${[1,2,3,4,5,6,0].map(i=>{ const d = D.config.semana[i]; return `<div class="dias-semana">
      <label class="check" style="margin:0"><input type="checkbox" ${d.fechado?'':'checked'} onchange="acao(()=>q(sb.from('expediente').update({fechado:!this.checked}).eq('dia_semana',${i})))"> ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][i]}</label>
      <input type="time" step="1800" value="${d.abre}" ${d.fechado?'disabled':''} onchange="mudarExpediente(${i},'abre',this.value)" aria-label="Abre">
      <input type="time" step="1800" value="${d.fecha}" ${d.fechado?'disabled':''} onchange="mudarExpediente(${i},'fecha',this.value)" aria-label="Fecha">
    </div>`; }).join('')}
    <label class="campo" style="margin-top:14px">Intervalo entre horários<select onchange="salvarConfig({passo_min:Number(this.value)})">${[30,60,90,120].map(p=>`<option value="${p}" ${D.config.passo===p?'selected':''}>${durTxt(p)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" ${D.config.pausa.ativa?'checked':''} onchange="salvarConfig({pausa_ativa:this.checked})"> Pausa de almoço (não recebe carros)</label>
    ${D.config.pausa.ativa?`<div class="grade" style="grid-template-columns:1fr 1fr"><label class="campo">De<input type="time" step="1800" value="${D.config.pausa.ini}" onchange="salvarConfig({pausa_ini:this.value})"></label><label class="campo">Até<input type="time" step="1800" value="${D.config.pausa.fim}" onchange="salvarConfig({pausa_fim:this.value})"></label></div>`:''}
    <label class="campo">Antecedência mínima para o cliente agendar (horas)<input type="number" min="0" step="0.5" value="${D.config.antecedencia}" onchange="salvarConfig({antecedencia_h:Math.max(0,Number(this.value))})"></label>
    <label class="campo">Cliente pode cancelar/remarcar sem perder o sinal até (horas antes)<input type="number" min="0" step="0.5" value="${D.config.prazoCancelar}" onchange="salvarConfig({prazo_cancelar_h:Math.max(0,Number(this.value))})"></label>
    <label class="campo">Agenda aberta para os próximos (dias)<input type="number" min="1" max="60" value="${D.config.diasAgenda}" onchange="salvarConfig({dias_agenda:Math.min(60,Math.max(1,Math.round(Number(this.value))))})"></label>
    <button class="btn sec bloco" onclick="irPara('agenda');abrirBloqueio()"><span>Bloquear um dia ou horário (feriado, imprevisto)</span></button>
  </div>
  <div class="traco">O QUE ENTRA NO CLUBE</div><div class="painel">
    <p class="mudo pequeno" style="margin-top:0">Marque os serviços que o assinante pode usar sem pagar (${D.config.clubeLavagens} por mês, de segunda a sexta). Os demais têm 10% de desconto.</p>
    ${D.servicos.map(s=>`<label class="check"><input type="checkbox" ${s.noClube?'checked':''} onchange="salvarServico('${s.id}',{no_clube:this.checked})"> ${esc(s.nome)} <span class="mudo pequeno">(${Object.entries(s.precos).filter(([,v])=>v!=null).map(([k])=>PORTES[k]).join(', ')})</span></label>`).join('')}
    <label class="campo">Quantas por mês<input type="number" min="1" max="31" value="${D.config.clubeLavagens}" onchange="salvarConfig({clube_lavagens:Math.min(31,Math.max(1,Math.round(Number(this.value))))})"></label>
  </div>
  <div class="traco">DURAÇÃO DOS SERVIÇOS</div><div class="painel rolagem"><table class="tabela"><tr><th>Serviço</th><th>Minutos</th></tr>
    ${D.servicos.map(s=>`<tr><td>${esc(s.nome)}</td><td><input type="number" min="10" step="10" value="${s.dur}" onchange="salvarServico('${s.id}',{duracao_min:Math.max(10,Math.round(Number(this.value)))})" aria-label="Duração ${esc(s.nome)}"></td></tr>`).join('')}
  </table><p class="mudo pequeno">A duração define quantos horários o serviço ocupa na agenda.</p></div>
  <div class="traco">OPERAÇÃO</div><div class="painel">
    <label class="campo">Carros atendidos ao mesmo tempo<input type="number" min="1" value="${D.config.capacidade}" onchange="salvarConfig({capacidade:Math.max(1,Math.round(Number(this.value)))})"></label>
    <label class="campo">Sinal via Pix no agendamento (R$)<input type="number" min="0" value="${D.config.sinal}" onchange="salvarConfig({sinal:Math.max(0,Number(this.value))})"></label>
    <label class="campo">Chave Pix da loja (aparece para o cliente pagar o sinal)<input value="${esc(D.loja.pix||'')}" placeholder="CNPJ, e-mail, celular ou chave aleatória" onchange="salvarLoja({pix:this.value.trim()})"></label>
    <label class="check"><input type="checkbox" ${D.config.fotosDepois?'checked':''} onchange="salvarConfig({fotos_depois:this.checked})"> Oferecer fotos do "depois" ao marcar o carro como pronto (sempre dá para pular)</label>
    <label class="campo">Guardar fotos (entrada e depois) por (dias)<input type="number" min="1" value="${D.config.fotosDias}" onchange="salvarConfig({fotos_dias:Math.max(1,Math.round(Number(this.value)))})"></label>
    <label class="campo">Garantia de chuva (horas)<input type="number" min="0" value="${D.config.chuvaHoras}" onchange="salvarConfig({chuva_horas:Math.max(0,Math.round(Number(this.value)))})"></label>
    <label class="campo">Pontos para uma lavagem grátis<input type="number" min="1" value="${D.config.pontosResgate}" onchange="salvarConfig({pontos_resgate:Math.max(1,Math.round(Number(this.value)))})"></label>
    ${Object.entries(PORTES).map(([k,n])=>`<label class="campo">Mensalidade do Clube, ${n} (R$)<input type="number" step="0.1" min="0" value="${D.config.clubePrecos[k]}" onchange="salvarConfig({clube_preco_${k}:Math.max(0,Number(this.value))})"></label>`).join('')}
  </div>
  <div class="traco">SUA CONTA</div><div class="painel">
    <p class="mudo pequeno" style="margin-top:0">Entrou como ${esc(sessao?.user?.email||'')}.</p>
    <button class="btn sec bloco" onclick="modalNovaSenha()"><span>Trocar minha senha</span></button>
    ${botaoInstalar()}
    ${suporte?`<button class="btn bloco" style="margin-top:8px" onclick="irPara('licenca')"><span>🔑 Licença do sistema (suporte)</span></button>`:''}
  </div>
  <p class="mudo pequeno" style="text-align:center">Preços de acordo com o site vizzaniestetica.com.br</p>`;
  return h;
}
// Cada campo de Ajustes grava na hora e recarrega (as regras do servidor passam a usar o novo valor)
const salvarConfig = campos => acao(()=>q(sb.from('config').update(campos).eq('id',1)), 'Salvo.');
const salvarServico = (id, campos) => acao(()=>q(sb.from('servicos').update(campos).eq('id',id)), 'Salvo.');
const salvarLoja = campos => acao(()=>q(sb.from('config').update({loja:{...D.loja, ...campos}}).eq('id',1)), 'Salvo.');

function mudarExpediente(i,campo,valor){
  const d = D.config.semana[i], novo = {...d, [campo]:valor};
  if(!valor || novo.abre>=novo.fecha){ aviso('O horário de fechar precisa ser depois do de abrir.'); render(); return; }
  const fora = D.at.filter(a=>a.status==='agendado' && a.data>=iso(HOJE) && dataDe(a.data).getDay()===i && (a.hora<novo.abre || a.hora>=novo.fecha));
  return acao(()=>q(sb.from('expediente').update({[campo]:valor}).eq('dia_semana',i)), fora.length?`Salvo. ${fora.length} agendamento(s) ficaram fora do novo horário: veja na Agenda.`:'Salvo.');
}

/* ================= VISTORIA DE ENTRADA =================
   Fotos com carimbo de placa, data e hora gravado na própria imagem,
   lista de avarias já existentes e ciência do cliente. */
const AVARIAS = ['Riscos','Amassados','Pintura queimada','Para-choque danificado','Trinca no vidro','Farol/lanterna danificado','Roda/pneu danificado','Retrovisor danificado','Estofado manchado/rasgado','Objetos de valor no carro'];
let vist = null;
function seloVistoria(a){
  if(a.vistoria && !a.vistoria.fotos.length) return `<span class="selo link" style="margin-top:4px" onclick="verVistoria('${a.id}')">📋 vistoria (fotos expiradas)</span>`;
  if(a.vistoria) return `<span class="selo link" style="margin-top:4px" onclick="verVistoria('${a.id}')">${a.vistoria.manter?'📌':'📷'} ${a.vistoria.fotos.length} foto${a.vistoria.fotos.length===1?'':'s'}${a.vistoria.avarias.length?' · '+a.vistoria.avarias.length+' avaria'+(a.vistoria.avarias.length>1?'s':''):''}</span>`;
  if(['recebido','pronto','entregue'].includes(a.status) && a.data===iso(HOJE)) return `<span class="selo vermelho" style="margin-top:4px">Sem vistoria</span>`;
  return '';
}
function abrirVistoria(id){
  const a = D.at.find(x=>x.id===id);
  vist = {id, fotos:[], avarias:[], semAvaria:false, obs:'', ciente:false};
  desenharVistoria();
}
function desenharVistoria(){
  const a = D.at.find(x=>x.id===vist.id), v = veiculo(a.placa), c = donoDe(a.placa);
  abrirModal(`<h2 style="margin-top:0">Vistoria de entrada</h2>
    <div class="linha entre">${placaHTML(v.placa)}<div style="text-align:right"><b>${esc(v.modelo)}</b><div class="mudo pequeno">${esc(c.nome)}</div></div></div>
    <p class="mudo pequeno" style="margin:12px 0 8px">Fotografe o carro <b>antes</b> de lavar: frente, traseira, as duas laterais, rodas e interior. Cada foto recebe placa, data e hora gravadas.</p>
    <label class="camera">📷 Tirar fotos<small>${vist.fotos.length?vist.fotos.length+' foto'+(vist.fotos.length>1?'s':'')+' · toque para adicionar mais':'câmera ou galeria'}</small>
      <input type="file" accept="image/*" capture="environment" multiple onchange="addFotos(this.files)"></label>
    ${vist.fotos.length?`<div class="fotos">${vist.fotos.map((f,i)=>`<button onclick="tirarFoto(${i})" aria-label="Remover foto ${i+1}"><img src="${f}" alt="Foto ${i+1}"><span class="x">×</span></button>`).join('')}</div>`:''}
    <div class="traco" style="margin-top:16px">AVARIAS JÁ EXISTENTES</div>
    <div class="avarias">
      <button class="ok ${vist.semAvaria?'on':''}" onclick="vist.semAvaria=!vist.semAvaria;if(vist.semAvaria)vist.avarias=[];desenharVistoria()">Sem avarias aparentes</button>
      ${AVARIAS.map(x=>`<button class="${vist.avarias.includes(x)?'on':''}" onclick="alternarAvaria('${x}')">${x}</button>`).join('')}
    </div>
    <textarea class="obs" placeholder="Onde está a avaria? Ex.: risco na porta traseira direita" oninput="vist.obs=this.value">${esc(vist.obs)}</textarea>
    <label class="check" style="margin-top:12px"><input type="checkbox" ${vist.ciente?'checked':''} onchange="vist.ciente=this.checked"> O cliente viu as fotos e concorda com o estado registrado</label>
    <button class="btn bloco" ${vist.fotos.length?'':'disabled'} onclick="salvarVistoria()"><span>Salvar vistoria e receber o carro</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="receberSemVistoria()"><span>Receber sem fotos</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}
function alternarAvaria(x){ vist.semAvaria=false; vist.avarias = vist.avarias.includes(x) ? vist.avarias.filter(y=>y!==x) : [...vist.avarias,x]; desenharVistoria(); }
function tirarFoto(i){ vist.fotos.splice(i,1); desenharVistoria(); }
async function addFotos(files){
  const a = D.at.find(x=>x.id===vist.id);
  aviso('Processando fotos...');
  for(const f of files){
    try{ vist.fotos.push(await carimbar(f, a.placa)); }catch(e){ aviso('Não consegui ler uma das fotos.'); }
  }
  desenharVistoria();
}
function carimbar(file, placa, rotulo='ANTES'){
  return new Promise((ok,erro)=>{
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const max = 1024, esc2 = Math.min(1, max/Math.max(img.width,img.height));
      const w = Math.round(img.width*esc2), h = Math.round(img.height*esc2);
      const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
      const g = cv.getContext('2d'); g.drawImage(img,0,0,w,h);
      const agora = new Date();
      const txt = `VIZZANI · ${rotulo} · ${placa} ·${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
      const fs = Math.max(14, Math.round(w/34));
      g.fillStyle='rgba(0,0,0,.65)'; g.fillRect(0,h-fs*1.9,w,fs*1.9);
      g.fillStyle='#fff'; g.font=`700 ${fs}px Arial, sans-serif`; g.textBaseline='middle';
      g.fillText(txt, fs*0.6, h-fs*0.95);
      URL.revokeObjectURL(url);
      ok(cv.toDataURL('image/jpeg',0.62));
    };
    img.onerror = () => { URL.revokeObjectURL(url); erro(); };
    img.src = url;
  });
}
async function salvarVistoria(){
  const a = D.at.find(x=>x.id===vist.id), agora = new Date(), vt = vist;
  abrirModal(`<div class="vazio">Enviando ${vt.fotos.length} foto${vt.fotos.length>1?'s':''}… não feche o app.</div>`);
  const ok = await acao(async()=>{
    await q(sb.from('vistorias').upsert({atendimento_id:a.id, avarias:vt.avarias, obs:vt.obs.trim()||null, ciente:vt.ciente, quando:agora.toISOString()}));
    await enviarFotos(a.id, 'antes', vt.fotos);
    await q(sb.from('atendimentos').update({status:'recebido'}).eq('id',a.id));
  });
  if(ok===false){ desenharVistoria(); return; }
  const c = cliente(donoAt(a)), v = veiculo(a.placa);
  const hora = agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const msg = `Olá, ${c.nome.split(' ')[0]}! Recebemos seu ${v.modelo} (${a.placa}) na Vizzani às ${hora}. Fizemos ${vt.fotos.length} foto${vt.fotos.length>1?'s':''} na entrada.${vt.avarias.length?' Avarias já existentes registradas: '+vt.avarias.join(', ').toLowerCase()+(vt.obs.trim()?' ('+vt.obs.trim()+')':'')+'.':' Nenhuma avaria aparente.'} Avisamos quando estiver pronto! 🚗`;
  vist = null;
  abrirModal(`<h2 style="margin-top:0">Vistoria salva ✅</h2>
    <p class="sub">As fotos ficam na ficha do veículo e o cliente também pode vê-las no histórico. Mande o registro para o cliente, assim fica documentado no WhatsApp também.</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="${linkZap(c.fone,msg)}"><span>Enviar registro no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}
function receberSemVistoria(){
  if(!confirm('Sem fotos, a Vizzani fica sem prova do estado do carro se o cliente reclamar de algum dano. Receber mesmo assim?')) return;
  const id = vist.id; vist=null; fecharModal();
  return acao(()=>q(sb.from('atendimentos').update({status:'recebido'}).eq('id',id)), 'Carro recebido sem vistoria.');
}
async function verVistoria(id){
  const a = D.at.find(x=>x.id===id), vt = a.vistoria, v = veiculo(a.placa);
  const quando = new Date(vt.quando);
  abrirModal(`<div class="vazio">Carregando fotos…</div>`);
  let urls = [];
  try{ urls = await urlsFotos(vt.fotos); }catch(e){ aviso(msgErro(e)); }
  abrirModal(`<h2 style="margin-top:0">Entrada do veículo</h2>
    <div class="linha entre">${placaHTML(v?.placa||a.placa,true)}<span class="mudo pequeno">${quando.toLocaleDateString('pt-BR')} às ${quando.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <p style="margin:12px 0 4px"><b>Avarias já existentes:</b> ${vt.avarias.length?esc(vt.avarias.join(', ')):'nenhuma aparente'}</p>
    ${vt.obs?`<p class="mudo" style="margin:0 0 4px">${esc(vt.obs)}</p>`:''}
    <p class="pequeno" style="margin:0 0 12px">${vt.ciente?'<span class="selo verde">Cliente ciente e de acordo</span>':'<span class="selo amarelo">Ciência do cliente não registrada</span>'}</p>
    ${vt.fotos.length?`<p class="mudo pequeno">${vt.manter?'📌 Fotos mantidas até o caso ser resolvido.':`As fotos são apagadas em ${fmtData(iso(addDias(new Date(vt.quando),D.config.fotosDias)))} (${D.config.fotosDias} dias após a entrada).`}</p>`:''}
    ${modo==='dono'&&vt.fotos.length?`<button class="btn sec bloco" style="margin-bottom:10px" onclick="alternarManter('${a.id}')"><span>${vt.manter?'Liberar exclusão automática':'Manter fotos (cliente reclamou)'}</span></button>`:''}
    ${vt.fotosApagadas?`<div class="info">As ${vt.fotosApagadas} fotos desta entrada foram apagadas após ${D.config.fotosDias} dias. As avarias anotadas continuam registradas.</div>`:''}
    ${urls.map((f,i)=>`<img class="foto-grande" src="${esc(f)}" alt="Foto ${i+1} da entrada">`).join('')}
    <button class="btn sec bloco" onclick="fecharModal()"><span>Fechar</span></button>`);
}

/* ================= CADASTRO E ACESSO =================
   Regra central: o WhatsApp identifica o cliente e a placa identifica o carro.
   Login do cliente: Supabase Auth com e-mail sintético 55{fone}@vizzani.app (o cliente só vê o WhatsApp).
   Criar conta e primeiro acesso passam pela Edge Function "conta". A apagada das fotos aos 30 dias é no servidor. */
const PLACA_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const soDig = s => String(s||'').replace(/\D/g,'');
const foneValido = f => /^[1-9]{2}9\d{8}$/.test(f);
const fmtFone = f => String(f).replace(/(\d{2})(\d{5})(\d{4})/,'($1) $2-$3');
const limparPlaca = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7);
function donoAt(a){ return a.clienteId || veiculo(a.placa)?.clienteId; }

async function alternarManter(id){
  const vt = D.at.find(x=>x.id===id).vistoria;
  const ok = await acao(()=>q(sb.from('vistorias').update({manter:!vt.manter}).eq('atendimento_id',id)), vt.manter?'Exclusão automática reativada.':'Fotos mantidas até você liberar.');
  if(ok!==false) verVistoria(id);
}

/* ---- Tela de entrada do cliente ---- */
let ent = {tela:'entrar', fone:'', email:'', senha:'', senha2:'', nome:'', placa:'', modelo:'', porte:'carro', consente:false, aceite:false, erro:'', info:''};
function campo(rot, chave, tipo='text', extra=''){
  return `<label class="campo">${rot}<input type="${tipo}" value="${esc(ent[chave])}" oninput="ent.${chave}=this.value" ${extra}></label>`;
}
function telaEntrar(){
  const t = ent.tela;
  let h = `<div style="margin-top:22px;text-align:center"><h1>Bem-vindo à Vizzani</h1><p class="sub">Agende, acompanhe seu carro e junte pontos.</p></div>`;
  if(t!=='primeiro') h += `<div class="abas-entrar"><button class="${t==='entrar'?'on':''}" onclick="ent.tela='entrar';ent.erro='';render()">Entrar</button><button class="${t==='criar'?'on':''}" onclick="ent.tela='criar';ent.erro='';render()">Criar conta</button></div>`;
  h += `<div class="painel"${t==='primeiro'?' style="margin-top:18px"':''}>`;
  if(ent.erro) h += `<div class="erro">${ent.erro}</div>`;
  if(ent.info) h += `<div class="info">${ent.info}</div>`;
  if(t==='entrar'){
    h += campo('WhatsApp (com DDD)','fone','tel','inputmode="tel" autocomplete="username" placeholder="(34) 99999-8888"')
       + campo('Senha','senha','password','autocomplete="current-password" onkeydown="if(event.key===\'Enter\')fazerLogin()"')
       + `<button class="btn bloco" onclick="fazerLogin()"><span>Entrar</span></button>
          <div class="linha entre" style="margin-top:8px"><button class="link" onclick="ent.tela='primeiro';ent.erro='';ent.info='';render()">Primeiro acesso</button><button class="link" onclick="esqueciSenha()">Esqueci minha senha</button></div>`;
  } else if(t==='equipe'){
    h += `<p style="margin-top:0"><b>Acesso da equipe</b></p>`
       + campo('E-mail','email','email','autocomplete="username"')
       + campo('Senha','senha','password','autocomplete="current-password" onkeydown="if(event.key===\'Enter\')entrarEquipe()"')
       + `<button class="btn bloco" onclick="entrarEquipe()"><span>Entrar</span></button>
          <div class="linha entre" style="margin-top:8px"><button class="link" onclick="ent.tela='entrar';ent.erro='';ent.info='';render()">Voltar</button><button class="link" onclick="recuperarEquipe()">Esqueci a senha</button></div>`;
  } else if(t==='criar'){
    h += campo('Seu nome','nome','text','autocomplete="name"')
       + campo('WhatsApp (com DDD)','fone','tel','inputmode="tel" autocomplete="tel" placeholder="(34) 99999-8888"')
       + campo('Crie uma senha (mínimo 6 caracteres)','senha','password','autocomplete="new-password"')
       + campo('Repita a senha','senha2','password','autocomplete="new-password"')
       + `<div class="traco">SEU VEÍCULO</div>`
       + `<label class="campo">Placa<input class="busca-placa" maxlength="7" value="${esc(ent.placa)}" oninput="this.value=limparPlaca(this.value);ent.placa=this.value" placeholder="ABC1D23"></label>`
       + campo('Modelo','modelo','text','placeholder="Ex.: Honda Civic"')
       + `<label class="campo">Tipo<select onchange="ent.porte=this.value">${Object.entries(PORTES).map(([k,n])=>`<option value="${k}" ${ent.porte===k?'selected':''}>${n}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" ${ent.aceite?'checked':''} onchange="ent.aceite=this.checked"> Concordo que a Vizzani guarde meus dados e as fotos de vistoria do meu carro por ${D.config.fotosDias} dias.</label>
          <label class="check"><input type="checkbox" ${ent.consente?'checked':''} onchange="ent.consente=this.checked"> Quero receber lembretes e ofertas pelo WhatsApp (opcional).</label>
          <button class="btn bloco" onclick="criarConta()"><span>Criar conta</span></button>`;
  } else {
    h += `<p style="margin-top:0"><b>Primeiro acesso</b></p><p class="mudo pequeno">Já é cliente da Vizzani e nunca usou o app? Informe seu WhatsApp, confirme a placa de um carro seu e crie sua senha.</p>`
       + campo('WhatsApp (com DDD)','fone','tel','inputmode="tel" autocomplete="username" placeholder="(34) 99999-8888"')
       + `<label class="campo">Placa<input class="busca-placa" maxlength="7" value="${esc(ent.placa)}" oninput="this.value=limparPlaca(this.value);ent.placa=this.value" placeholder="ABC1D23"></label>`
       + campo('Crie uma senha (mínimo 6 caracteres)','senha','password','autocomplete="new-password"')
       + campo('Repita a senha','senha2','password','autocomplete="new-password"')
       + `<button class="btn bloco" onclick="primeiroAcesso()"><span>Criar senha e entrar</span></button>
          <div style="text-align:center;margin-top:8px"><button class="link" onclick="ent.tela='entrar';ent.erro='';ent.info='';render()">Voltar</button></div>`;
  }
  h += `</div><div style="text-align:center;margin-top:18px">${t==='equipe'?'':`<button class="link mudo pequeno" style="color:var(--prata-escura)" onclick="ent.tela='equipe';ent.erro='';ent.info='';render()">Acesso da equipe</button>`}</div>`;
  return h;
}
function erroEnt(msg){ ent.erro=msg; ent.info=''; carregando(false); render(); window.scrollTo({top:0}); }
const ENT_VAZIO = () => ({tela:'entrar', fone:'', email:'', senha:'', senha2:'', nome:'', placa:'', modelo:'', porte:'carro', consente:false, aceite:false, erro:'', info:''});
async function entrarCom(email, senha){
  carregando(true);
  try{
    const { data, error } = await sb.auth.signInWithPassword({email, password:senha});
    if(error) return error;
    ent = ENT_VAZIO();
    await aoMudarSessao(data.session);
    return null;
  }finally{ carregando(false); }
}
async function sair(){
  if(!confirm('Sair da sua conta neste aparelho?')) return;
  await sb.auth.signOut();
  ent = ENT_VAZIO(); await aoMudarSessao(null);
}
async function fazerLogin(){
  const fone = soDig(ent.fone);
  if(!foneValido(fone)) return erroEnt('Digite o WhatsApp com DDD, ex.: (34) 99999-8888.');
  if(!ent.senha) return erroEnt('Digite sua senha.');
  const erro = await entrarCom(emailDoFone(fone), ent.senha);
  if(erro) erroEnt(/Invalid login/i.test(erro.message) ? 'WhatsApp ou senha incorretos. Se você é cliente da Vizzani e nunca entrou no app, toque em "Primeiro acesso".' : msgErro(erro));
}
async function entrarEquipe(){
  const email = ent.email.trim().toLowerCase();
  if(!email.includes('@') || !ent.senha) return erroEnt('Informe e-mail e senha.');
  const erro = await entrarCom(email, ent.senha);
  if(erro) return erroEnt(/Invalid login/i.test(erro.message) ? 'E-mail ou senha incorretos.' : msgErro(erro));
}
async function recuperarEquipe(){
  const email = ent.email.trim().toLowerCase();
  if(!email.includes('@')) return erroEnt('Digite seu e-mail acima e toque de novo em "Esqueci a senha".');
  carregando(true);
  const { error } = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname});
  carregando(false);
  if(error) return erroEnt(msgErro(error));
  ent.erro=''; ent.info='Se esse e-mail for da equipe, chega um link para criar uma senha nova. Abra o link neste aparelho.'; render();
}
// Abre ao voltar do link de recuperação (e em Ajustes, para trocar a senha)
function modalNovaSenha(){
  abrirModal(`<h2 style="margin-top:0">Nova senha</h2>
    <label class="campo">Nova senha (mínimo 6 caracteres)<input id="ns-1" type="password" autocomplete="new-password"></label>
    <label class="campo">Repita a senha<input id="ns-2" type="password" autocomplete="new-password"></label>
    <button class="btn bloco" onclick="salvarNovaSenha()"><span>Salvar senha</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Cancelar</span></button>`);
}
async function salvarNovaSenha(){
  const s1 = document.getElementById('ns-1').value, s2 = document.getElementById('ns-2').value;
  if(s1.length<6) return aviso('A senha precisa ter pelo menos 6 caracteres.');
  if(s1!==s2) return aviso('As senhas não são iguais.');
  const { error } = await sb.auth.updateUser({password:s1});
  if(error) return aviso(msgErro(error));
  fecharModal(); aviso('Senha alterada.');
  if(!perfil){ const { data } = await sb.auth.getSession(); await aoMudarSessao(data.session); }
}
function validarSenha(){
  if(ent.senha.length<6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if(ent.senha!==ent.senha2) return 'As senhas não são iguais.';
  return '';
}
async function primeiroAcesso(){
  const fone = soDig(ent.fone);
  if(!foneValido(fone)) return erroEnt('Digite o WhatsApp com DDD, ex.: (34) 99999-8888.');
  if(!PLACA_RE.test(ent.placa)) return erroEnt('Digite a placa de um carro seu, ex.: ABC1D23.');
  const e = validarSenha(); if(e) return erroEnt(e);
  carregando(true);
  try{ await chamarConta({acao:'primeiro_acesso', fone, placa:ent.placa, senha:ent.senha}); }
  catch(err){ return erroEnt(err.message); }
  const erro = await entrarCom(emailDoFone(fone), ent.senha);
  if(erro) return erroEnt(msgErro(erro));
  aviso('Senha criada. Bem-vindo!');
}
async function criarConta(){
  const fone = soDig(ent.fone), nome = ent.nome.trim(), modelo = ent.modelo.trim();
  if(nome.length<2) return erroEnt('Informe seu nome.');
  if(!foneValido(fone)) return erroEnt('WhatsApp inválido. Use DDD + número com 9 dígitos, ex.: (34) 99999-8888.');
  const e = validarSenha(); if(e) return erroEnt(e);
  if(!PLACA_RE.test(ent.placa)) return erroEnt('Placa inválida. Use o formato ABC1D23 ou ABC1234.');
  if(!modelo) return erroEnt('Informe o modelo do veículo.');
  if(!ent.aceite) return erroEnt('Para criar a conta, é preciso concordar com o uso dos dados.');
  carregando(true);
  let r;
  try{ r = await chamarConta({acao:'criar', nome, fone, senha:ent.senha, placa:ent.placa, modelo, porte:ent.porte, consente:ent.consente, aceite:ent.aceite}); }
  catch(err){
    if(err.codigo==='primeiro_acesso'){ const placa = ent.placa; ent.tela='primeiro'; ent.fone=fone; ent.placa=placa; ent.senha=''; ent.senha2=''; ent.erro=''; ent.info=err.message; carregando(false); return render(); }
    if(err.codigo==='ja_tem_conta'){ ent.tela='entrar'; ent.fone=fone; ent.senha=''; }
    return erroEnt(err.message);
  }
  const erro = await entrarCom(emailDoFone(fone), ent.senha || '');
  if(erro) return erroEnt('Conta criada! Entre com seu WhatsApp e senha.');
  aviso(r.veiculo==='pendente' ? 'Conta criada! A placa já estava cadastrada: a Vizzani vai confirmar.' : 'Conta criada! Bem-vindo.');
}
function esqueciSenha(){
  abrirModal(`<h2 style="margin-top:0">Esqueceu a senha?</h2>
    <p class="sub">Fale com a Vizzani pelo WhatsApp. A equipe libera seu acesso e você cria uma senha nova confirmando a placa do seu carro.</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=${D.loja.whatsapp}&text=${encodeURIComponent('Olá! Esqueci minha senha do app da Vizzani.')}"><span>Falar no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Voltar</span></button>`);
}

/* ---- Área do cliente logado ---- */
let formV = {placa:'',modelo:'',porte:'carro',erro:''};
function abrirAddVeiculo(){
  abrirModal(`<h2 style="margin-top:0">Adicionar veículo</h2>
    ${formV.erro?`<div class="erro">${formV.erro}</div>`:''}
    <label class="campo">Placa<input class="busca-placa" maxlength="7" value="${esc(formV.placa)}" oninput="this.value=limparPlaca(this.value);formV.placa=this.value" placeholder="ABC1D23"></label>
    <label class="campo">Modelo<input value="${esc(formV.modelo)}" oninput="formV.modelo=this.value" placeholder="Ex.: Jeep Compass"></label>
    <label class="campo">Tipo<select onchange="formV.porte=this.value">${Object.entries(PORTES).map(([k,n])=>`<option value="${k}" ${formV.porte===k?'selected':''}>${n}</option>`).join('')}</select></label>
    <button class="btn bloco" onclick="salvarVeiculoCliente()"><span>Adicionar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="formV={placa:'',modelo:'',porte:'carro',erro:''};fecharModal()"><span>Cancelar</span></button>`);
}
async function salvarVeiculoCliente(){
  if(!PLACA_RE.test(formV.placa)){ formV.erro='Placa inválida. Use o formato ABC1D23 ou ABC1234.'; return abrirAddVeiculo(); }
  if(!formV.modelo.trim()){ formV.erro='Informe o modelo.'; return abrirAddVeiculo(); }
  const dados = {...formV}; fecharModal();
  const r = await acao(()=>q(sb.rpc('adicionar_veiculo', {p_placa:dados.placa, p_modelo:dados.modelo.trim(), p_porte:dados.porte})));
  if(r===false){ formV = dados; return; }
  formV={placa:'',modelo:'',porte:'carro',erro:''};
  aviso(r==='ok'?'Veículo adicionado.':r==='seu'?'Esse carro já está na sua conta.':'Essa placa já estava cadastrada. A Vizzani vai confirmar.');
}
function abrirMeusDados(){
  const c = cliente(clienteAtual);
  abrirModal(`<h2 style="margin-top:0">Meus dados</h2>
    <label class="campo">Nome<input id="md-nome" value="${esc(c.nome)}"></label>
    <p class="mudo pequeno" style="margin-top:-4px">WhatsApp: ${fmtFone(c.fone)}. Para trocar o número, fale com a Vizzani.</p>
    <label class="check"><input type="checkbox" id="md-cons" ${c.consente?'checked':''}> Quero receber ofertas e lembretes de retorno pelo WhatsApp</label>
    <p class="mudo pequeno" style="margin-top:-4px">Lembretes dos seus horários agendados sempre são enviados.</p>
    ${pushAtivo()?'<p class="pequeno">🔔 Lembretes no celular ativados.</p>':`<button class="btn sec bloco" style="margin-bottom:10px" onclick="ativarNotificacoes()"><span>🔔 Ativar lembretes no celular</span></button>`}
    <button class="btn bloco" onclick="salvarMeusDados()"><span>Salvar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="modalNovaSenha()"><span>Trocar minha senha</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}
function salvarMeusDados(){
  const n = document.getElementById('md-nome').value.trim(), cons = document.getElementById('md-cons').checked;
  if(n.length<2) return aviso('Informe seu nome.');
  fecharModal();
  return acao(()=>q(sb.rpc('atualizar_meus_dados', {p_nome:n, p_consente:cons})), 'Dados atualizados.');
}

/* ---- Lado do dono: pendências, edição, transferência, senha ---- */
function painelPendencias(){
  if(!D.pendencias.length) return '';
  return `<div class="traco">CADASTROS PARA CONFIRMAR</div><div class="painel" style="border-color:#8a6510">${D.pendencias.map(p=>{
    const novo = cliente(p.clienteId), v = veiculo(p.placa), atual = v?cliente(v.clienteId):null;
    return `<div style="padding:10px 0;border-bottom:1px solid var(--linha)">
      <div class="linha entre">${placaHTML(p.placa,true)}<span class="mudo pequeno">${new Date(p.quando).toLocaleDateString('pt-BR')}</span></div>
      <p class="pequeno" style="margin:8px 0"><b>${esc(novo.nome)}</b>, ${fmtFone(novo.fone)}, cadastrou esta placa no app. Hoje ela está na ficha de <b>${esc(atual?.nome||'—')}</b>${atual?', '+fmtFone(atual.fone):''}. Pode ser carro vendido ou placa digitada errada.</p>
      <div class="grade" style="grid-template-columns:1fr 1fr"><button class="btn peq" onclick="resolverPendencia('${p.id}',true)"><span>Passar para ${esc(novo.nome.split(' ')[0])}</span></button><button class="btn sec peq" onclick="resolverPendencia('${p.id}',false)"><span>Recusar</span></button></div>
    </div>`;}).join('')}</div>`;
}
async function resolverPendencia(id, aceitar){
  const p = D.pendencias.find(x=>x.id===id), novo = cliente(p.clienteId), v = veiculo(p.placa);
  const msg = aceitar ? `Olá, ${novo.nome.split(' ')[0]}! Confirmamos: a placa ${p.placa} já está na sua conta do app da Vizzani. 🚗` : `Olá, ${novo.nome.split(' ')[0]}! Não conseguimos confirmar a placa ${p.placa} no app da Vizzani. Pode conferir se foi digitada certa? Qualquer dúvida, é só responder aqui.`;
  const ok = await acao(async()=>{
    if(aceitar) await q(sb.from('veiculos').update({cliente_id:novo.id, modelo:p.modelo || v?.modelo, ...(p.porte?{porte:p.porte}:{})}).eq('placa',p.placa));
    await q(sb.from('pendencias').delete().eq('id',id));
    await enviarRecado(novo.id, null, aceitar ? `A placa ${p.placa} foi confirmada e já está na sua conta.` : `Não conseguimos confirmar a placa ${p.placa}. Confira se foi digitada certa ou fale com a Vizzani.`);
  });
  if(ok===false) return;
  abrirModal(`<h2 style="margin-top:0">${aceitar?'Carro transferido':'Pedido recusado'}</h2><p class="sub">${aceitar?'O histórico antigo continua na ficha do carro, mas os pontos e fotos do dono anterior não aparecem para o novo dono.':'O carro continua com o dono atual.'}</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="${linkZap(novo.fone,msg)}"><span>Avisar ${esc(novo.nome.split(' ')[0])} no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}
function editarCliente(cid, erro=''){
  const c = cliente(cid);
  abrirModal(`<h2 style="margin-top:0">Editar cliente</h2>${erro?`<div class="erro">${erro}</div>`:''}
    <label class="campo">Nome<input id="ec-nome" value="${esc(c.nome)}"></label>
    <label class="campo">WhatsApp<input id="ec-fone" inputmode="tel" value="${fmtFone(c.fone)}"></label>
    <label class="check"><input type="checkbox" id="ec-cons" ${c.consente?'checked':''}> Autorizou receber lembretes e ofertas pelo WhatsApp</label>
    <button class="btn bloco" onclick="salvarEdicao('${cid}')"><span>Salvar</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Cancelar</span></button>`);
}
function salvarEdicao(cid){
  const c = cliente(cid), nome = document.getElementById('ec-nome').value.trim(), fone = soDig(document.getElementById('ec-fone').value);
  if(nome.length<2) return editarCliente(cid,'Informe o nome.');
  if(!foneValido(fone)) return editarCliente(cid,'WhatsApp inválido. Use DDD + número com 9 dígitos.');
  const outro = D.clientes.find(x=>x.fone===fone && x.id!==cid);
  if(outro) return editarCliente(cid,`Esse WhatsApp já é de ${esc(outro.nome)}. Se o carro mudou de dono, use "Transferir carro".`);
  // O login do cliente é o próprio número: com o app em uso, primeiro libera a senha e ele refaz o primeiro acesso com o número novo
  if(fone!==c.fone && c.temLogin) return editarCliente(cid,'Este cliente usa o app com o número antigo. Toque em "Cliente esqueceu a senha" na ficha e depois troque o número; ele entra de novo pelo "Primeiro acesso" com o número novo.');
  const consente = document.getElementById('ec-cons').checked;
  fecharModal();
  return acao(()=>q(sb.from('clientes').update({nome, fone, consente}).eq('id',cid)), 'Cliente atualizado.');
}
function transferirVeiculo(placa, erro=''){
  const v = veiculo(placa), atual = cliente(v.clienteId);
  abrirModal(`<h2 style="margin-top:0">Transferir carro</h2><p class="sub">O ${esc(v.modelo)} de ${esc(atual.nome)} foi vendido? Informe o novo dono.</p>${erro?`<div class="erro" style="margin-top:10px">${erro}</div>`:''}
    <label class="campo" style="margin-top:12px">WhatsApp do novo dono<input id="tv-fone" inputmode="tel" placeholder="(34) 99999-8888"></label>
    <label class="campo">Nome (se ainda não for cliente)<input id="tv-nome"></label>
    <label class="check"><input type="checkbox" id="tv-cons"> Novo dono autorizou receber mensagens</label>
    <p class="mudo pequeno">O histórico de serviços fica com o carro. Pontos e fotos do dono anterior não passam para o novo.</p>
    <button class="btn bloco" onclick="confirmarTransferencia('${placa}')"><span>Transferir</span></button>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Cancelar</span></button>`);
}
function confirmarTransferencia(placa){
  const v = veiculo(placa), fone = soDig(document.getElementById('tv-fone').value), nome = document.getElementById('tv-nome').value.trim();
  if(!foneValido(fone)) return transferirVeiculo(placa,'WhatsApp inválido. Use DDD + número com 9 dígitos.');
  if(fone===cliente(v.clienteId).fone) return transferirVeiculo(placa,'Esse já é o dono atual.');
  const existente = D.clientes.find(x=>x.fone===fone);
  if(!existente && nome.length<2) return transferirVeiculo(placa,'Número novo: informe o nome do novo dono.');
  const consente = document.getElementById('tv-cons').checked;
  fecharModal();
  return acao(async()=>{
    let cid = existente?.id;
    if(!cid) [{id:cid}] = await q(sb.from('clientes').insert({nome, fone, consente}).select('id'));
    await q(sb.from('veiculos').update({cliente_id:cid}).eq('placa',placa));
    await q(sb.from('pendencias').delete().eq('placa',placa).eq('cliente_id',cid));
  }, `Carro transferido para ${existente?.nome || nome}.`);
}
// Apaga o login do cliente pela Edge Function "conta" (só o dono consegue); cadastro e histórico continuam
async function liberarSenha(cid){
  const c = cliente(cid);
  if(!confirm(`Liberar nova senha para ${c.nome}? A senha atual deixa de funcionar e, no próximo acesso, o cliente cria outra confirmando a placa do carro.`)) return;
  const ok = await acao(()=>chamarConta({acao:'liberar_senha', cliente_id:cid}));
  if(ok===false) return;
  abrirModal(`<h2 style="margin-top:0">Acesso liberado</h2><p class="sub">Avise ${esc(c.nome.split(' ')[0])} para entrar no app pelo "Primeiro acesso" e criar a senha nova.</p>
    <a class="btn zap bloco" style="margin-top:14px;text-decoration:none" target="_blank" rel="noopener" onclick="fecharModal()" href="${linkZap(c.fone,`Olá, ${c.nome.split(' ')[0]}! Liberamos seu acesso ao app da Vizzani. Abra o app, toque em "Primeiro acesso", confirme a placa do seu carro e crie uma senha nova.`)}"><span>Avisar no WhatsApp</span></a>
    <button class="btn sec bloco" style="margin-top:8px" onclick="fecharModal()"><span>Fechar</span></button>`);
}

iniciar();
