/*
 * Estacionamento universitário — frontend demonstrativo.
 * HTML/CSS/JS sem build. Dados normalizados conforme o DER enviado.
 * AutenticacaoDemo e RepositorioLocal são os pontos de troca pela API.
 * A API futura deverá repetir todas as regras e garantir as transações no banco.
 */
(() => {
  "use strict";

  function iniciar() {
    const CHAVE_DADOS = "estacionamento.universitario.v1";
    const CHAVE_SESSAO = "estacionamento.operador.demo";
    const FUSO = "America/Sao_Paulo";
    const DIAS = [
      { id: 1, nome: "Segunda", curto: "Seg" },
      { id: 2, nome: "Terça", curto: "Ter" },
      { id: 3, nome: "Quarta", curto: "Qua" },
      { id: 4, nome: "Quinta", curto: "Qui" },
      { id: 5, nome: "Sexta", curto: "Sex" },
      { id: 6, nome: "Sábado", curto: "Sáb" },
      { id: 0, nome: "Domingo", curto: "Dom" }
    ];
    const OPERADOR = { id_operador: 1, nome: "Operador de demonstração", login: "admin", turno: "Demonstração" };
    const $ = (id) => document.getElementById(id);
    const todos = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];
    const clone = (objeto) => JSON.parse(JSON.stringify(objeto));
    // Todo valor variável usado em templates passa por escapar().
    const escapar = (valor) => String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const normalizarPlaca = (valor) => String(valor).toUpperCase().replace(/[\s-]/g, "");
    const placaValida = (valor) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(valor);
    const placaFormatada = (valor) => /^[A-Z]{3}[0-9]{4}$/.test(valor) ? `${valor.slice(0, 3)}-${valor.slice(3)}` : valor;
    const normalizarTexto = (valor) => String(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const idNovo = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ativos = (dados) => dados.registros.filter((r) => r.data_hora_saida === null);
    const usuarioPorId = (dados, id) => dados.usuarios.find((u) => u.id_usuario === id);
    const vagaPorId = (dados, id) => dados.vagas.find((v) => v.id_vaga === id);
    const veiculosDoUsuario = (dados, id) => dados.veiculos.filter((v) => v.id_usuario === id && v.ativo);
    const escalasDoUsuario = (dados, id) => dados.escalas.filter((e) => e.id_usuario === id);
    const formatadorData = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const formatadorCabecalho = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    let estado;
    let logado = false;
    let consultaAtual = "";
    let paginaHistorico = 1;
    let cadastroEmEdicao = null;
    let revisaoCadastro = 0;
    let contadorVeiculos = 0;
    let vagaPretendidaEntrada = null;
    let acaoConfirmada = null;
    let diaRenderizado;
    let timerNotificacao;
    let persistenciaBloqueada = false;
    const focoDialogos = new Map();

    function hoje() {
      const partes = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const pegar = (tipo) => Number(partes.find((p) => p.type === tipo).value);
      return new Date(Date.UTC(pegar("year"), pegar("month") - 1, pegar("day"))).getUTCDay();
    }

    function cpfValido(cpf) {
      if (!/^[0-9]{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
      for (let tamanho = 9; tamanho <= 10; tamanho++) {
        let soma = 0;
        for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
        const digito = (soma * 10) % 11 % 10;
        if (digito !== Number(cpf[tamanho])) return false;
      }
      return true;
    }

    function dadosIniciais() {
      // Pessoas, vínculos e escalas abaixo são exemplos fictícios editáveis.
      // A placa original PM12345 foi ajustada para PMA1234 (formato aceito).
      const pessoas = [
        ["u1", "PM", "Funcionário(a)", "PMA1234", "Veículo de apoio", [1, 2, 3, 4, 5], 1],
        ["u2", "Victor", "Funcionário(a)", "VIC1234", "Hatch", [1, 3, 5], 2],
        ["u3", "Samara", "Professor(a)", "SAM1234", "Sedã", [2, 4], 2],
        ["u4", "Angola", "Professor(a)", "ANG1234", "Hatch", [1, 2, 3, 4, 5], 3],
        ["u5", "Luiz", "Funcionário(a)", "LUI1234", "Sedã", [1, 2, 3, 4, 5, 6], 4]
      ];
      return {
        versao: 1, revisao: 0,
        usuarios: pessoas.map(([id_usuario, nome, cargo]) => ({ id_usuario, nome, cargo, cpf: "", ativo: true })),
        veiculos: pessoas.map(([id_usuario, , , placa, modelo]) => ({ placa, id_usuario, modelo, ativo: true })),
        vagas: Array.from({ length: 12 }, (_, i) => ({ id_vaga: i + 1, codigo_vaga: `A${String(i + 1).padStart(2, "0")}`, tipo: "Comum" })),
        escalas: pessoas.flatMap(([id_usuario, , , , , dias, id_vaga]) => dias.map((dia_semana) => ({ id_escala: `${id_usuario}-${dia_semana}`, id_usuario, id_vaga, dia_semana }))),
        operadores: [OPERADOR], registros: []
      };
    }

    // Valida os dados lidos antes de usá-los; nunca apaga dados inválidos automaticamente.
    function validarEstado(dados) {
      const exigir = (condicao) => { if (!condicao) throw new Error("O conjunto de dados locais está inválido ou pertence a outra versão."); };
      const texto = (s, min = 1, max = 100) => typeof s === "string" && s.length >= min && s.length <= max;
      const semDuplicados = (lista) => new Set(lista).size === lista.length;
      exigir(dados && dados.versao === 1 && Number.isSafeInteger(dados.revisao) && dados.revisao >= 0);
      for (const chave of ["usuarios", "veiculos", "vagas", "escalas", "operadores", "registros"]) exigir(Array.isArray(dados[chave]));
      exigir(dados.vagas.length === 12 && dados.vagas.every((v, i) => v.id_vaga === i + 1 && v.codigo_vaga === `A${String(i + 1).padStart(2, "0")}` && v.tipo === "Comum"));
      exigir(dados.operadores.length === 1 && dados.operadores[0].id_operador === OPERADOR.id_operador);
      exigir(dados.usuarios.every((u) => texto(u.id_usuario) && texto(u.nome, 2, 80) && ["Professor(a)", "Funcionário(a)"].includes(u.cargo) && typeof u.ativo === "boolean" && (u.cpf === "" || cpfValido(u.cpf))));
      exigir(semDuplicados(dados.usuarios.map((u) => u.id_usuario)));
      exigir(semDuplicados(dados.usuarios.filter((u) => u.ativo && u.cpf).map((u) => u.cpf)));
      exigir(dados.veiculos.every((v) => placaValida(v.placa) && texto(v.modelo, 0, 60) && typeof v.ativo === "boolean" && usuarioPorId(dados, v.id_usuario) && (!v.ativo || usuarioPorId(dados, v.id_usuario).ativo)));
      exigir(semDuplicados(dados.veiculos.map((v) => v.placa)));
      exigir(dados.escalas.every((e) => texto(e.id_escala) && usuarioPorId(dados, e.id_usuario)?.ativo && vagaPorId(dados, e.id_vaga) && Number.isInteger(e.dia_semana) && e.dia_semana >= 0 && e.dia_semana <= 6));
      exigir(semDuplicados(dados.escalas.map((e) => e.id_escala)));
      exigir(semDuplicados(dados.escalas.map((e) => `${e.id_vaga}-${e.dia_semana}`)));
      exigir(semDuplicados(dados.escalas.map((e) => `${e.id_usuario}-${e.dia_semana}`)));
      exigir(dados.usuarios.filter((u) => u.ativo).every((u) => veiculosDoUsuario(dados, u.id_usuario).length && escalasDoUsuario(dados, u.id_usuario).length));
      exigir(dados.registros.every((r) => texto(r.id_registro) && vagaPorId(dados, r.id_vaga) && usuarioPorId(dados, r.id_usuario) && placaValida(r.placa) && r.id_operador === OPERADOR.id_operador && texto(r.nome_condutor, 2, 80) && ["reserva", "rodizio"].includes(r.tipo_alocacao) && typeof r.data_hora_entrada === "string" && Number.isFinite(Date.parse(r.data_hora_entrada)) && (r.data_hora_saida === null || (typeof r.data_hora_saida === "string" && Date.parse(r.data_hora_saida) >= Date.parse(r.data_hora_entrada)))));
      exigir(semDuplicados(dados.registros.map((r) => r.id_registro)));
      const abertos = ativos(dados);
      exigir(semDuplicados(abertos.map((r) => r.id_vaga)) && semDuplicados(abertos.map((r) => r.placa)) && semDuplicados(abertos.map((r) => r.id_usuario)));
      exigir(abertos.every((r) => usuarioPorId(dados, r.id_usuario)?.ativo && dados.veiculos.some((v) => v.ativo && v.placa === r.placa && v.id_usuario === r.id_usuario)));
      return dados;
    }

    const RepositorioLocal = {
      ler() {
        const texto = localStorage.getItem(CHAVE_DADOS);
        return texto === null ? null : validarEstado(JSON.parse(texto));
      },
      salvar(dados) {
        validarEstado(dados);
        try { localStorage.setItem(CHAVE_DADOS, JSON.stringify(dados)); }
        catch { throw new Error("Não foi possível salvar neste navegador. Verifique o espaço e a permissão de armazenamento. A alteração não foi aplicada."); }
      },
      async alterar(mutacao, revisaoEsperada = null) {
        if (!logado || persistenciaBloqueada) throw new Error("Entre no sistema e verifique os dados antes de continuar.");
        const operacao = () => {
          // Relê dentro do bloqueio para impedir sobrescritas entre abas compatíveis.
          const atual = this.ler();
          if (!atual) throw new Error("Os dados foram removidos em outra aba. Recarregue a página.");
          if (revisaoEsperada !== null && atual.revisao !== revisaoEsperada) {
            estado = atual;
            renderizar();
            throw new Error("Os dados mudaram enquanto este formulário estava aberto. Feche e abra novamente antes de salvar.");
          }
          const proximo = clone(atual);
          mutacao(proximo);
          proximo.revisao = atual.revisao + 1;
          this.salvar(proximo);
          estado = proximo;
          renderizar();
          $("estadoSalvamento").textContent = "Alterações salvas";
        };
        if (navigator.locks?.request) await navigator.locks.request(CHAVE_DADOS, operacao);
        else operacao();
      }
    };

    const AutenticacaoDemo = {
      entrar(usuario, senha) {
        if (usuario !== "admin" || senha !== "1234") throw new Error("Usuário ou senha incorretos.");
        // Não salva a senha. Este marcador não é autenticação de produção.
        try { sessionStorage.setItem(CHAVE_SESSAO, "ativa"); } catch { /* A sessão pode durar só até a próxima recarga. */ }
        logado = true;
      },
      restaurar() { try { return sessionStorage.getItem(CHAVE_SESSAO) === "ativa"; } catch { return false; } },
      sair() { try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* Não impede sair da interface. */ } logado = false; }
    };

    function reservaDaVaga(dados, id, dia = hoje()) {
      return dados.escalas.find((e) => e.id_vaga === id && e.dia_semana === dia);
    }

    function verificarAutorizacao(dados, placa) {
      if (!placaValida(placa)) return { permitido: false, codigo: "formato", mensagem: "Informe uma placa no formato ABC-1234 ou ABC1D23." };
      const veiculo = dados.veiculos.find((v) => v.ativo && v.placa === placa);
      const usuario = veiculo && usuarioPorId(dados, veiculo.id_usuario);
      if (!usuario?.ativo) return { permitido: false, codigo: "desconhecido", mensagem: "Placa não cadastrada. Cadastre o condutor e a escala antes de registrar a entrada." };
      const registro = ativos(dados).find((r) => r.id_usuario === usuario.id_usuario);
      if (registro) return { permitido: false, codigo: "estacionado", usuario, veiculo, registro, mensagem: registro.placa === placa ? `${usuario.nome} já está no pátio, na vaga ${vagaPorId(dados, registro.id_vaga).codigo_vaga}.` : `${usuario.nome} já possui outro veículo no pátio (${placaFormatada(registro.placa)}). Registre a saída primeiro.` };
      const escala = dados.escalas.find((e) => e.id_usuario === usuario.id_usuario && e.dia_semana === hoje());
      if (!escala) return { permitido: false, codigo: "dia", usuario, veiculo, mensagem: `${usuario.nome} não tem acesso previsto para hoje. Confira a escala no cadastro.` };
      const ocupadas = new Set(ativos(dados).map((r) => r.id_vaga));
      const opcoes = dados.vagas.filter((v) => {
        const reserva = reservaDaVaga(dados, v.id_vaga);
        return !ocupadas.has(v.id_vaga) && (!reserva || reserva.id_usuario === usuario.id_usuario);
      }).sort((a, b) => Number(b.id_vaga === escala.id_vaga) - Number(a.id_vaga === escala.id_vaga) || a.id_vaga - b.id_vaga);
      if (!opcoes.length) return { permitido: false, codigo: "lotado", usuario, veiculo, mensagem: "Nenhuma vaga disponível para este condutor. As vagas restantes estão ocupadas ou reservadas para outras pessoas." };
      const sugerida = opcoes[0];
      return { permitido: true, codigo: "autorizado", usuario, veiculo, escala, opcoes, sugerida, mensagem: `${usuario.nome} tem acesso autorizado hoje. ${sugerida.id_vaga === escala.id_vaga ? "Reserva" : "Realocação disponível"} na vaga ${sugerida.codigo_vaga}.` };
    }

    function notificar(texto, erro = false) {
      clearTimeout(timerNotificacao);
      $("notificacao").textContent = texto;
      $("notificacao").classList.toggle("erro", erro);
      $("notificacao").hidden = false;
      timerNotificacao = setTimeout(() => { $("notificacao").hidden = true; }, 6500);
    }

    function abrirDialogo(id) {
      focoDialogos.set(id, document.activeElement);
      $(id).showModal();
    }

    function fecharDialogo(id) { $(id).close(); }

    function limparErro(id) { $(id).textContent = ""; }

    function erroNoFormulario(id, erro) {
      $(id).textContent = erro.message || "Não foi possível concluir esta ação.";
    }

    function mostrarPagina(id, moverFoco = true) {
      if (!logado || !["painel", "cadastros", "escalas", "historico"].includes(id)) return;
      todos(".pagina").forEach((p) => { p.hidden = p.id !== id; });
      todos("[data-view]").forEach((b) => {
        const ativo = b.dataset.view === id;
        b.classList.toggle("ativo", ativo);
        if (ativo) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
      });
      document.title = `${$(id).querySelector("h1").textContent} | Estacionamento universitário`;
      if (moverFoco) $("conteudo").focus({ preventScroll: true });
    }

    function mostrarSistema() {
      $("loginTela").hidden = true;
      $("sistema").hidden = false;
      $("senha").value = "";
      $("senha").type = "password";
      $("mostrarSenha").textContent = "Mostrar";
      $("mostrarSenha").setAttribute("aria-pressed", "false");
      $("mostrarSenha").setAttribute("aria-label", "Mostrar senha");
      mostrarPagina("painel");
      renderizar();
    }

    function renderizar() {
      if (!estado || !logado) return;
      const focoVaga = document.activeElement?.dataset?.vaga;
      const dia = hoje();
      diaRenderizado = dia;
      $("dataAtual").textContent = formatadorCabecalho.format(new Date());
      $("dataAtual").dateTime = new Date().toISOString();
      const abertos = ativos(estado);
      const ocupadas = abertos.length;
      const rotativas = estado.vagas.filter((v) => !abertos.some((r) => r.id_vaga === v.id_vaga) && !reservaDaVaga(estado, v.id_vaga)).length;
      $("total").textContent = estado.vagas.length;
      $("ocupadas").textContent = ocupadas;
      $("livres").textContent = estado.vagas.length - ocupadas;
      $("rotativas").textContent = rotativas;
      $("taxaOcupacao").textContent = `${Math.round(ocupadas / estado.vagas.length * 100)}% de ocupação`;
      $("btnLiberar").disabled = ocupadas === 0;
      $("vagas").innerHTML = estado.vagas.map((v) => {
        const acesso = abertos.find((r) => r.id_vaga === v.id_vaga);
        const reserva = reservaDaVaga(estado, v.id_vaga);
        const situacao = acesso ? "ocupada" : reserva ? "reservada" : "livre";
        const titulo = acesso ? placaFormatada(acesso.placa) : reserva ? "Reservada hoje" : "Livre para rodízio";
        const detalhe = acesso ? acesso.nome_condutor : reserva ? usuarioPorId(estado, reserva.id_usuario).nome : "Disponível para realocação";
        return `<button type="button" class="vaga ${situacao}" data-vaga="${v.id_vaga}" aria-label="${escapar(`${v.codigo_vaga}, ${situacao}, ${titulo}, ${detalhe}. ${acesso ? "Registrar saída" : "Registrar entrada"}`)}"><span class="vaga-topo"><span class="vaga-codigo">${v.codigo_vaga}</span><span class="vaga-simbolo" aria-hidden="true">${acesso ? "↙" : reserva ? "◷" : "✓"}</span></span><span class="vaga-status">${escapar(titulo)}</span><span class="vaga-detalhe" title="${escapar(detalhe)}">${escapar(detalhe)}</span></button>`;
      }).join("");
      renderizarCadastros();
      renderizarEscalas();
      renderizarHistorico();
      if (consultaAtual) renderizarPesquisa();
      if ($("entradaDialog").open) atualizarEntrada();
      if (focoVaga) document.querySelector(`[data-vaga="${Number(focoVaga)}"]`)?.focus({ preventScroll: true });
    }

    function renderizarPesquisa() {
      const r = verificarAutorizacao(estado, consultaAtual);
      const titulo = r.permitido ? "Acesso autorizado" : ({ formato: "Confira a placa", desconhecido: "Sem cadastro", estacionado: "Veículo no pátio", dia: "Fora da escala de hoje", lotado: "Sem vaga disponível" }[r.codigo]);
      let acao = "";
      if (r.permitido) acao = `<button class="botao primario pequeno" type="button" data-entrada-placa="${escapar(consultaAtual)}">Registrar entrada</button>`;
      else if (r.codigo === "estacionado") acao = `<button class="botao secundario pequeno" type="button" data-saida="${escapar(r.registro.id_registro)}">Registrar saída</button>`;
      else if (r.codigo === "desconhecido") acao = `<button class="botao secundario pequeno" type="button" data-cadastrar-placa="${escapar(consultaAtual)}">Cadastrar condutor</button>`;
      $("resultado").innerHTML = `<div><span class="etiqueta ${r.permitido ? "verde" : r.codigo === "estacionado" ? "" : "amarela"}">${titulo}</span><div><strong>${escapar(placaFormatada(consultaAtual))}</strong></div><p>${escapar(r.mensagem)}</p></div>${acao}`;
      $("resultado").hidden = false;
    }

    function renderizarCadastros() {
      const termo = normalizarTexto($("filtroCadastros").value.trim());
      const cadastrados = estado.usuarios.filter((u) => u.ativo);
      const lista = cadastrados.filter((u) => normalizarTexto(`${u.nome} ${veiculosDoUsuario(estado, u.id_usuario).map((v) => `${v.placa} ${placaFormatada(v.placa)}`).join(" ")}`).includes(termo));
      $("contagemCadastros").textContent = `${cadastrados.length} condutor(es) ativo(s) · ${lista.length} exibido(s)`;
      $("usuarios").innerHTML = lista.map((u) => {
        const escalas = escalasDoUsuario(estado, u.id_usuario);
        const acesso = ativos(estado).find((r) => r.id_usuario === u.id_usuario);
        const autorizado = escalas.some((e) => e.dia_semana === hoje());
        const status = acesso ? `No pátio · ${vagaPorId(estado, acesso.id_vaga).codigo_vaga}` : autorizado ? "Previsto hoje" : "Fora da escala";
        return `<tr><td><strong>${escapar(u.nome)}</strong><small>${escapar(u.cargo)}</small></td><td>${veiculosDoUsuario(estado, u.id_usuario).map((v) => `<div><code>${escapar(placaFormatada(v.placa))}</code><small>${escapar(v.modelo || "Modelo não informado")}</small></div>`).join("")}</td><td><div class="chips">${DIAS.filter((d) => escalas.some((e) => e.dia_semana === d.id)).map((d) => `<span class="dia-chip">${d.curto}</span>`).join("")}</div></td><td><span class="etiqueta ${acesso ? "" : autorizado ? "verde" : "neutra"}">${escapar(status)}</span></td><td><div class="acoes-linha"><button type="button" class="botao secundario pequeno" data-editar="${escapar(u.id_usuario)}" aria-label="Editar cadastro de ${escapar(u.nome)}">Editar</button><button type="button" class="botao perigo-suave pequeno" data-excluir="${escapar(u.id_usuario)}" aria-label="Excluir cadastro de ${escapar(u.nome)}">Excluir</button></div></td></tr>`;
      }).join("") || '<tr><td colspan="5" class="celula-vazia">Nenhum condutor encontrado. Use “Novo condutor” para cadastrar.</td></tr>';
    }

    function renderizarEscalas() {
      const diaAtual = hoje();
      $("cabecalhoEscalas").innerHTML = `<tr><th scope="col">Vaga</th>${DIAS.map((d) => `<th scope="col" class="${d.id === diaAtual ? "dia-atual" : ""}">${d.nome}${d.id === diaAtual ? " · hoje" : ""}</th>`).join("")}</tr>`;
      $("corpoEscalas").innerHTML = estado.vagas.map((v) => `<tr><th scope="row">${v.codigo_vaga}</th>${DIAS.map((d) => {
        const e = reservaDaVaga(estado, v.id_vaga, d.id);
        return `<td class="${d.id === diaAtual ? "dia-atual" : ""}">${e ? `<span class="nome-escala">${escapar(usuarioPorId(estado, e.id_usuario).nome)}</span>` : '<span class="rotativa-texto">Rodízio</span>'}</td>`;
      }).join("")}</tr>`).join("");
    }

    function permanencia(r) {
      const fim = r.data_hora_saida ? Date.parse(r.data_hora_saida) : Date.now();
      const minutos = Math.max(0, Math.floor((fim - Date.parse(r.data_hora_entrada)) / 60000));
      if (minutos < 60) return `${minutos} min`;
      return `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
    }

    function renderizarHistorico() {
      const busca = normalizarTexto($("filtroHistorico").value.trim());
      const status = $("statusHistorico").value;
      const lista = estado.registros.filter((r) => normalizarTexto(`${r.nome_condutor} ${r.placa} ${placaFormatada(r.placa)}`).includes(busca) && (status === "todos" || (status === "abertos" ? r.data_hora_saida === null : r.data_hora_saida !== null))).sort((a, b) => Date.parse(b.data_hora_entrada) - Date.parse(a.data_hora_entrada));
      const porPagina = 10;
      const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
      paginaHistorico = Math.min(paginaHistorico, totalPaginas);
      $("registros").innerHTML = lista.slice((paginaHistorico - 1) * porPagina, paginaHistorico * porPagina).map((r) => `<tr><td><strong>${escapar(r.nome_condutor)}</strong><small><code>${escapar(placaFormatada(r.placa))}</code></small></td><td><strong>${escapar(vagaPorId(estado, r.id_vaga).codigo_vaga)}</strong><small>${r.tipo_alocacao === "reserva" ? "Reserva" : "Rodízio"}</small></td><td class="data-tabela">${formatadorData.format(new Date(r.data_hora_entrada))}</td><td class="data-tabela">${r.data_hora_saida ? formatadorData.format(new Date(r.data_hora_saida)) : '<span class="etiqueta">No pátio</span>'}</td><td>${permanencia(r)}</td><td>Operador demo</td><td>${r.data_hora_saida ? '<span class="texto-suave">Encerrado</span>' : `<button type="button" class="botao secundario pequeno" data-saida="${escapar(r.id_registro)}" aria-label="Registrar saída de ${escapar(r.nome_condutor)}">Saída</button>`}</td></tr>`).join("") || '<tr><td colspan="7" class="celula-vazia">Nenhuma movimentação encontrada.</td></tr>';
      $("resumoRegistros").textContent = `${lista.length} registro(s) · Página ${paginaHistorico} de ${totalPaginas}`;
      $("paginaAnterior").disabled = paginaHistorico === 1;
      $("proximaPagina").disabled = paginaHistorico === totalPaginas;
    }

    function abrirEntrada(placa = "", vaga = null) {
      $("formEntrada").reset();
      vagaPretendidaEntrada = vaga;
      $("placaEntrada").value = placa;
      limparErro("erroEntrada");
      atualizarEntrada(vaga);
      abrirDialogo("entradaDialog");
      if (!placa) $("placaEntrada").focus();
    }

    function atualizarEntrada(preferida = vagaPretendidaEntrada) {
      const placa = normalizarPlaca($("placaEntrada").value);
      const r = verificarAutorizacao(estado, placa);
      const anterior = preferida || Number($("vagaEntrada").value);
      $("autorizacaoEntrada").textContent = placa ? r.mensagem : "Informe a placa de um veículo cadastrado para consultar a escala de hoje.";
      $("autorizacaoEntrada").classList.toggle("erro", Boolean(placa && !r.permitido));
      $("vagaEntrada").innerHTML = r.permitido ? r.opcoes.map((v) => `<option value="${v.id_vaga}">${v.codigo_vaga} · ${v.id_vaga === r.escala.id_vaga ? "Reserva do condutor" : "Rodízio"}</option>`).join("") : '<option value="">Aguardando autorização</option>';
      if (r.permitido && r.opcoes.some((v) => v.id_vaga === anterior)) $("vagaEntrada").value = String(anterior);
      if (preferida && r.permitido && !r.opcoes.some((v) => v.id_vaga === preferida)) $("autorizacaoEntrada").textContent += " A vaga selecionada no mapa não está disponível para este condutor; escolha uma das opções abaixo.";
      $("vagaEntrada").disabled = !r.permitido;
      $("confirmarEntrada").disabled = !r.permitido;
    }

    async function registrarEntrada(event) {
      event.preventDefault();
      limparErro("erroEntrada");
      const placa = normalizarPlaca($("placaEntrada").value);
      const idVaga = Number($("vagaEntrada").value);
      $("confirmarEntrada").disabled = true;
      try {
        await RepositorioLocal.alterar((dados) => {
          const r = verificarAutorizacao(dados, placa);
          if (!r.permitido) throw new Error(r.mensagem);
          if (!r.opcoes.some((v) => v.id_vaga === idVaga)) throw new Error("Esta vaga não está mais disponível. Consulte a placa novamente.");
          dados.registros.push({ id_registro: idNovo(), id_vaga: idVaga, placa, id_usuario: r.usuario.id_usuario, id_operador: OPERADOR.id_operador, data_hora_entrada: new Date().toISOString(), data_hora_saida: null, nome_condutor: r.usuario.nome, tipo_alocacao: idVaga === r.escala.id_vaga ? "reserva" : "rodizio" });
        });
        fecharDialogo("entradaDialog");
        notificar(`Entrada de ${placaFormatada(placa)} registrada na vaga ${vagaPorId(estado, idVaga).codigo_vaga}.`);
      } catch (erro) { erroNoFormulario("erroEntrada", erro); atualizarEntrada(); }
    }

    function pedirConfirmacao(titulo, texto, rotulo, acao) {
      $("tituloConfirmar").textContent = titulo;
      $("textoConfirmar").textContent = texto;
      $("aceitarConfirmacao").textContent = rotulo;
      limparErro("erroConfirmar");
      acaoConfirmada = acao;
      abrirDialogo("confirmarDialog");
      $("cancelarConfirmacao").focus();
    }

    function abrirSaida(id) {
      const registro = ativos(estado).find((r) => r.id_registro === id);
      if (!registro) return notificar("A saída desse veículo já foi registrada.", true);
      pedirConfirmacao("Registrar saída?", `${registro.nome_condutor} · ${placaFormatada(registro.placa)}\nVaga ${vagaPorId(estado, registro.id_vaga).codigo_vaga}\nEntrada: ${formatadorData.format(new Date(registro.data_hora_entrada))}\n\nA vaga será desocupada e o registro ficará no histórico.`, "Confirmar saída", async () => {
        await RepositorioLocal.alterar((dados) => {
          const atual = ativos(dados).find((r) => r.id_registro === id);
          if (!atual) throw new Error("A saída já foi registrada em outra aba.");
          if (Date.now() < Date.parse(atual.data_hora_entrada)) throw new Error("O relógio está anterior à entrada. Corrija a data e a hora do dispositivo.");
          atual.data_hora_saida = new Date().toISOString();
        });
        notificar("Saída registrada. A ocupação foi atualizada.");
      });
    }

    function adicionarVeiculo(veiculo = {}) {
      const chave = ++contadorVeiculos;
      const linha = document.createElement("div");
      linha.className = "veiculo-linha";
      linha.innerHTML = `<div><label for="placaCadastro${chave}">Placa *</label><input id="placaCadastro${chave}" class="placa-cadastro placa-input" required maxlength="9" autocomplete="off" placeholder="ABC-1234" value="${escapar(veiculo.placa || "")}"></div><div><label for="modeloCadastro${chave}">Modelo <span class="opcional">opcional</span></label><input id="modeloCadastro${chave}" class="modelo-cadastro" maxlength="60" value="${escapar(veiculo.modelo || "")}" placeholder="Ex.: Hatch prata"></div><button type="button" class="botao perigo-suave pequeno remover-veiculo" aria-label="Remover este veículo">Remover</button>`;
      $("veiculosFormulario").appendChild(linha);
      todos(".remover-veiculo").forEach((b) => { b.disabled = $("veiculosFormulario").children.length === 1; });
      return linha;
    }

    function abrirCadastro(id = null, placa = "") {
      const usuario = id ? usuarioPorId(estado, id) : null;
      if (id && (!usuario || !usuario.ativo)) return notificar("Este cadastro não está mais ativo.", true);
      if (id && ativos(estado).some((r) => r.id_usuario === id)) return notificar("Registre a saída do veículo antes de alterar este cadastro.", true);
      cadastroEmEdicao = id;
      revisaoCadastro = estado.revisao;
      $("formCadastro").reset();
      limparErro("erroCadastro");
      $("tituloCadastro").textContent = id ? "Editar condutor" : "Novo condutor";
      $("nomeCondutor").value = usuario?.nome || "";
      $("cargoCondutor").value = usuario?.cargo || "";
      $("cpfCondutor").value = usuario?.cpf || "";
      $("veiculosFormulario").replaceChildren();
      (id ? veiculosDoUsuario(estado, id) : [{ placa }]).forEach(adicionarVeiculo);
      $("diasFormulario").innerHTML = DIAS.map((d) => {
        const escala = id ? estado.escalas.find((e) => e.id_usuario === id && e.dia_semana === d.id) : null;
        return `<div><label for="dia${d.id}">${d.nome}</label><select id="dia${d.id}" data-dia="${d.id}"><option value="">Sem acesso</option>${estado.vagas.map((v) => {
          const reserva = reservaDaVaga(estado, v.id_vaga, d.id);
          const indisponivel = reserva && reserva.id_usuario !== id;
          return `<option value="${v.id_vaga}" ${escala?.id_vaga === v.id_vaga ? "selected" : ""} ${indisponivel ? "disabled" : ""}>${v.codigo_vaga}${indisponivel ? " · reservada" : ""}</option>`;
        }).join("")}</select></div>`;
      }).join("");
      abrirDialogo("cadastroDialog");
      $("nomeCondutor").focus();
    }

    function validarCadastro(dados, formulario, idEdicao) {
      if (formulario.nome.length < 2 || formulario.nome.length > 80) throw new Error("Informe um nome entre 2 e 80 caracteres.");
      if (!["Professor(a)", "Funcionário(a)"].includes(formulario.cargo)) throw new Error("Selecione o cargo do condutor.");
      if (formulario.cpf && !cpfValido(formulario.cpf)) throw new Error("O CPF informado é inválido. Confira os dígitos ou deixe o campo vazio na demonstração.");
      if (formulario.cpf && dados.usuarios.some((u) => u.ativo && u.id_usuario !== idEdicao && u.cpf === formulario.cpf)) throw new Error("Este CPF já está vinculado a outro condutor.");
      if (!formulario.veiculos.length || formulario.veiculos.some((v) => !placaValida(v.placa))) throw new Error("Informe placas válidas no formato ABC-1234 ou ABC1D23.");
      if (formulario.veiculos.some((v) => v.modelo.length > 60)) throw new Error("O modelo deve ter até 60 caracteres.");
      if (new Set(formulario.veiculos.map((v) => v.placa)).size !== formulario.veiculos.length) throw new Error("Há placas repetidas neste cadastro.");
      for (const veiculo of formulario.veiculos) {
        if (dados.veiculos.some((v) => v.ativo && v.id_usuario !== idEdicao && v.placa === veiculo.placa)) throw new Error(`A placa ${placaFormatada(veiculo.placa)} já pertence a outro condutor.`);
      }
      if (!formulario.escalas.length) throw new Error("Defina ao menos um dia de acesso e sua vaga.");
      for (const escala of formulario.escalas) {
        if (!vagaPorId(dados, escala.id_vaga) || !DIAS.some((d) => d.id === escala.dia_semana)) throw new Error("Selecione uma vaga válida para cada dia.");
        const conflito = reservaDaVaga(dados, escala.id_vaga, escala.dia_semana);
        if (conflito && conflito.id_usuario !== idEdicao) throw new Error(`A vaga ${vagaPorId(dados, escala.id_vaga).codigo_vaga} já está reservada na ${DIAS.find((d) => d.id === escala.dia_semana).nome.toLowerCase()}.`);
      }
      if (idEdicao && !usuarioPorId(dados, idEdicao)?.ativo) throw new Error("Este cadastro foi excluído. Feche o formulário e atualize a lista.");
      if (idEdicao && ativos(dados).some((r) => r.id_usuario === idEdicao)) throw new Error("Registre a saída do veículo antes de editar o cadastro.");
    }

    async function salvarCadastro(event) {
      event.preventDefault();
      limparErro("erroCadastro");
      const cpfInformado = $("cpfCondutor").value.trim();
      if (cpfInformado && !/^[0-9.\-\s]+$/.test(cpfInformado)) return erroNoFormulario("erroCadastro", new Error("Use apenas números e a pontuação do CPF."));
      const formulario = {
        nome: $("nomeCondutor").value.trim().replace(/\s+/g, " "),
        cargo: $("cargoCondutor").value,
        cpf: cpfInformado.replace(/\D/g, ""),
        veiculos: todos(".veiculo-linha").map((linha) => ({ placa: normalizarPlaca(linha.querySelector(".placa-cadastro").value), modelo: linha.querySelector(".modelo-cadastro").value.trim() })),
        escalas: todos("[data-dia]").filter((s) => s.value !== "").map((s) => ({ dia_semana: Number(s.dataset.dia), id_vaga: Number(s.value) }))
      };
      $("salvarCadastro").disabled = true;
      try {
        await RepositorioLocal.alterar((dados) => {
          validarCadastro(dados, formulario, cadastroEmEdicao);
          const id = cadastroEmEdicao || idNovo();
          const novoUsuario = { id_usuario: id, nome: formulario.nome, cpf: formulario.cpf, cargo: formulario.cargo, ativo: true };
          const indice = dados.usuarios.findIndex((u) => u.id_usuario === id);
          if (indice < 0) dados.usuarios.push(novoUsuario); else dados.usuarios[indice] = novoUsuario;
          // Histórico guarda o nome e a placa da entrada, mesmo após edições.
          dados.veiculos.filter((v) => v.id_usuario === id).forEach((v) => { v.ativo = false; });
          for (const veiculo of formulario.veiculos) {
            const anterior = dados.veiculos.findIndex((v) => v.placa === veiculo.placa);
            const atualizado = { ...veiculo, id_usuario: id, ativo: true };
            if (anterior < 0) dados.veiculos.push(atualizado);
            else dados.veiculos[anterior] = atualizado;
          }
          dados.escalas = dados.escalas.filter((e) => e.id_usuario !== id);
          dados.escalas.push(...formulario.escalas.map((e) => ({ ...e, id_usuario: id, id_escala: idNovo() })));
        }, revisaoCadastro);
        fecharDialogo("cadastroDialog");
        notificar(cadastroEmEdicao ? "Cadastro atualizado." : "Condutor cadastrado. A escala já foi atualizada.");
      } catch (erro) { erroNoFormulario("erroCadastro", erro); }
      finally { $("salvarCadastro").disabled = false; }
    }

    function excluirCadastro(id) {
      const usuario = usuarioPorId(estado, id);
      if (!usuario?.ativo) return;
      if (ativos(estado).some((r) => r.id_usuario === id)) return notificar("Registre a saída do veículo antes de excluir este cadastro.", true);
      const revisao = estado.revisao;
      pedirConfirmacao("Excluir cadastro?", `O cadastro de ${usuario.nome} e seus veículos serão desativados, e as reservas serão removidas. As movimentações anteriores serão preservadas.`, "Excluir cadastro", async () => {
        await RepositorioLocal.alterar((dados) => {
          if (ativos(dados).some((r) => r.id_usuario === id)) throw new Error("Este condutor entrou no pátio. Registre a saída primeiro.");
          const atual = usuarioPorId(dados, id);
          if (!atual?.ativo) throw new Error("Este cadastro já foi excluído.");
          atual.ativo = false;
          dados.veiculos.filter((v) => v.id_usuario === id).forEach((v) => { v.ativo = false; });
          dados.escalas = dados.escalas.filter((e) => e.id_usuario !== id);
        }, revisao);
        notificar("Cadastro excluído. O histórico foi preservado.");
      });
    }

    function informarProblemaDados() {
      persistenciaBloqueada = true;
      AutenticacaoDemo.sair();
      todos("dialog[open]").forEach((d) => d.close());
      $("sistema").hidden = true;
      $("loginTela").hidden = false;
      $("btnEntrar").disabled = true;
      $("problemaDados").hidden = false;
      $("mensagemDados").textContent = "Não foi possível carregar ou salvar os dados deste navegador. Você pode baixar uma cópia antes de restaurar a demonstração. A restauração substitui todos os dados locais deste projeto.";
    }

    // Eventos: formulários também funcionam com Enter; ações nunca dependem de prompt().
    $("formLogin").addEventListener("submit", (event) => {
      event.preventDefault();
      limparErro("erroLogin");
      if (persistenciaBloqueada) return;
      try {
        const usuario = $("usuario").value.trim();
        const senha = $("senha").value; // Não remove espaços de senhas.
        if (!usuario || !senha) throw new Error("Preencha o usuário e a senha.");
        AutenticacaoDemo.entrar(usuario, senha);
        mostrarSistema();
      } catch (erro) { erroNoFormulario("erroLogin", erro); }
    });
    $("mostrarSenha").addEventListener("click", () => {
      const mostrar = $("senha").type === "password";
      $("senha").type = mostrar ? "text" : "password";
      $("mostrarSenha").textContent = mostrar ? "Ocultar" : "Mostrar";
      $("mostrarSenha").setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
      $("mostrarSenha").setAttribute("aria-pressed", String(mostrar));
    });
    $("btnSair").addEventListener("click", () => {
      AutenticacaoDemo.sair();
      $("sistema").hidden = true;
      $("loginTela").hidden = false;
      $("notificacao").hidden = true;
      consultaAtual = "";
      $("campoPesquisa").value = "";
      $("resultado").hidden = true;
      limparErro("erroLogin");
      document.title = "Estacionamento universitário | Portaria";
      $("usuario").focus();
    });
    todos("[data-view]").forEach((b) => b.addEventListener("click", () => mostrarPagina(b.dataset.view)));
    $("sistema").querySelector(".marca").addEventListener("click", (e) => { e.preventDefault(); mostrarPagina("painel"); });
    todos("[data-close]").forEach((b) => b.addEventListener("click", () => fecharDialogo(b.dataset.close)));
    todos("dialog").forEach((d) => d.addEventListener("close", () => {
      const anterior = focoDialogos.get(d.id);
      if (anterior?.isConnected) anterior.focus({ preventScroll: true });
      else $("conteudo").focus({ preventScroll: true });
      if (d.id === "confirmarDialog") acaoConfirmada = null;
    }));
    $("formPesquisa").addEventListener("submit", (event) => {
      event.preventDefault();
      consultaAtual = normalizarPlaca($("campoPesquisa").value);
      if (!consultaAtual) { $("resultado").hidden = true; return; }
      renderizarPesquisa();
    });
    $("campoPesquisa").addEventListener("input", () => {
      consultaAtual = "";
      $("resultado").hidden = true;
    });
    $("sistema").addEventListener("click", (event) => {
      const botao = event.target.closest("button");
      if (!botao || !logado) return;
      if (botao.dataset.action === "nova-entrada") abrirEntrada();
      if (botao.dataset.entradaPlaca) abrirEntrada(botao.dataset.entradaPlaca);
      if (botao.dataset.cadastrarPlaca) abrirCadastro(null, botao.dataset.cadastrarPlaca);
      if (botao.dataset.vaga) {
        const id = Number(botao.dataset.vaga);
        const registro = ativos(estado).find((r) => r.id_vaga === id);
        const reserva = reservaDaVaga(estado, id);
        const placa = reserva ? veiculosDoUsuario(estado, reserva.id_usuario)[0]?.placa || "" : "";
        if (registro) abrirSaida(registro.id_registro); else abrirEntrada(placa, id);
      }
      if (botao.dataset.saida) abrirSaida(botao.dataset.saida);
      if (botao.dataset.editar) abrirCadastro(botao.dataset.editar);
      if (botao.dataset.excluir) excluirCadastro(botao.dataset.excluir);
    });
    $("placaEntrada").addEventListener("input", () => { limparErro("erroEntrada"); atualizarEntrada(); });
    $("vagaEntrada").addEventListener("change", () => { vagaPretendidaEntrada = Number($("vagaEntrada").value); });
    $("formEntrada").addEventListener("submit", registrarEntrada);
    $("formCadastro").addEventListener("submit", salvarCadastro);
    $("btnNovoCadastro").addEventListener("click", () => abrirCadastro());
    $("btnAdicionarVeiculo").addEventListener("click", () => adicionarVeiculo().querySelector("input").focus());
    $("veiculosFormulario").addEventListener("click", (event) => {
      const botao = event.target.closest(".remover-veiculo");
      if (!botao || $("veiculosFormulario").children.length <= 1) return;
      botao.closest(".veiculo-linha").remove();
      todos(".remover-veiculo").forEach((b) => { b.disabled = $("veiculosFormulario").children.length === 1; });
      $("btnAdicionarVeiculo").focus();
    });
    $("filtroCadastros").addEventListener("input", renderizarCadastros);
    for (const id of ["filtroHistorico", "statusHistorico"]) $(id).addEventListener(id === "statusHistorico" ? "change" : "input", () => { paginaHistorico = 1; renderizarHistorico(); });
    $("paginaAnterior").addEventListener("click", () => { paginaHistorico--; renderizarHistorico(); });
    $("proximaPagina").addEventListener("click", () => { paginaHistorico++; renderizarHistorico(); });
    $("btnLiberar").addEventListener("click", () => {
      const ids = ativos(estado).map((r) => r.id_registro);
      if (!ids.length) return;
      const revisao = estado.revisao;
      pedirConfirmacao("Registrar saída de todos?", `Serão encerradas ${ids.length} ocupação(ões). Confirme que todos esses veículos já deixaram o pátio. Os registros continuarão no histórico.`, "Confirmar todas as saídas", async () => {
        await RepositorioLocal.alterar((dados) => {
          const hora = new Date().toISOString();
          const encerrar = dados.registros.filter((r) => ids.includes(r.id_registro));
          if (encerrar.some((r) => Date.parse(hora) < Date.parse(r.data_hora_entrada))) throw new Error("O relógio está anterior a uma das entradas. Corrija a data e a hora do dispositivo.");
          encerrar.forEach((r) => { r.data_hora_saida = hora; });
        }, revisao);
        notificar(`${ids.length} saída(s) registrada(s).`);
      });
    });
    $("formConfirmar").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!acaoConfirmada) return;
      const acao = acaoConfirmada;
      $("aceitarConfirmacao").disabled = true;
      try { await acao(); fecharDialogo("confirmarDialog"); }
      catch (erro) { erroNoFormulario("erroConfirmar", erro); }
      finally { $("aceitarConfirmacao").disabled = false; }
    });
    $("btnBackup").addEventListener("click", () => {
      try {
        const bruto = localStorage.getItem(CHAVE_DADOS);
        if (!bruto) throw new Error("Nenhum dado local disponível para baixar.");
        const url = URL.createObjectURL(new Blob([bruto], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "estacionamento-backup-local.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (erro) { notificar(erro.message, true); }
    });
    $("btnRestaurar").addEventListener("click", () => pedirConfirmacao("Substituir os dados locais?", "Todos os cadastros, escalas e registros locais deste projeto serão substituídos pelos exemplos iniciais. Baixe uma cópia antes de continuar se precisar preservar os dados.", "Restaurar demonstração", async () => {
      const restaurar = () => {
        const novo = dadosIniciais();
        RepositorioLocal.salvar(novo);
        estado = novo;
      };
      if (navigator.locks?.request) await navigator.locks.request(CHAVE_DADOS, restaurar); else restaurar();
      persistenciaBloqueada = false;
      $("problemaDados").hidden = true;
      $("btnEntrar").disabled = false;
      notificar("Demonstração restaurada. Entre para continuar.");
    }));
    window.addEventListener("storage", (event) => {
      if (event.key !== CHAVE_DADOS && event.key !== null) return;
      try {
        const atualizado = RepositorioLocal.ler();
        if (!atualizado) throw new Error("Dados removidos.");
        estado = atualizado;
        renderizar();
        if (logado) notificar("Dados atualizados a partir de outra aba.");
      } catch { informarProblemaDados(); }
    });
    // O dia muda pelo fuso do campus. Ocupações noturnas permanecem abertas.
    setInterval(() => {
      if (!logado || !estado) return;
      if (hoje() !== diaRenderizado) {
        renderizar();
        notificar("Um novo dia começou. As reservas foram atualizadas; ocupações continuam até a saída.");
      } else {
        $("dataAtual").textContent = formatadorCabecalho.format(new Date());
        $("dataAtual").dateTime = new Date().toISOString();
        if (!$("historico").hidden && !$("historico").contains(document.activeElement)) renderizarHistorico();
      }
    }, 30000);
    window.addEventListener("focus", () => { if (logado && estado) renderizar(); });

    try {
      estado = RepositorioLocal.ler();
      if (!estado) { estado = dadosIniciais(); RepositorioLocal.salvar(estado); }
      logado = AutenticacaoDemo.restaurar();
      if (logado) mostrarSistema();
    } catch { informarProblemaDados(); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
  else iniciar();
})();