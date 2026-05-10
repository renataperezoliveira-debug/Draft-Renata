(function () {
  'use strict';

  const app = document.getElementById('app');
  const navButtons = document.querySelectorAll('.nav-btn');

  const state = {
    programs: [],
    programsById: {},
    sessions: [],
    currentView: 'home',
    currentSessionId: null
  };

  // ----- Utilidades -----
  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Erro na requisicao');
    }
    return res.status === 204 ? null : res.json();
  }

  function fillTemplate(id) {
    const tpl = document.getElementById(id);
    return tpl.content.cloneNode(true);
  }

  function setActiveNav(view) {
    navButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // ----- Navegacao -----
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });

  async function navigate(view, params) {
    state.currentView = view;
    setActiveNav(view);
    app.innerHTML = '<div class="empty">Carregando...</div>';

    // Garante que os programas estejam carregados antes de qualquer view
    // que dependa deles. Sem isso ha condicao de corrida: clicar em
    // "Nova sessao" antes do bootstrap terminar deixava o combo vazio.
    await loadPrograms();
    app.innerHTML = '';

    if (view === 'home') return renderHome();
    if (view === 'new') return renderNew();
    if (view === 'session') return renderSession(params && params.id);
    if (view === 'evolution') return renderEvolution();
    if (view === 'data') return renderData();
  }

  // ----- Carregamento de programas (com cache) -----
  let programsPromise = null;
  function loadPrograms() {
    if (state.programs.length) return Promise.resolve();
    if (programsPromise) return programsPromise;
    programsPromise = (async () => {
      try {
        const list = await api('/api/programs');
        const details = await Promise.all(list.map((p) => api('/api/programs/' + p.id)));
        state.programs = list;
        state.programsById = {};
        details.forEach((p) => { state.programsById[p.id] = p; });
      } catch (e) {
        console.error('Falha ao carregar programas:', e);
        programsPromise = null; // permite retry no proximo navigate
        throw e;
      }
    })();
    return programsPromise;
  }

  async function bootstrap() {
    navigate('home');
  }

  // ----- View: Home (lista de sessoes) -----
  async function renderHome() {
    const node = fillTemplate('tpl-home');
    app.appendChild(node);
    const programSelect = document.getElementById('filterProgram');
    state.programs.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      programSelect.appendChild(opt);
    });

    const filterChild = document.getElementById('filterChild');
    const list = document.getElementById('sessionsList');

    const refresh = async () => {
      state.sessions = await api('/api/sessions');
      const child = filterChild.value.toLowerCase().trim();
      const program = programSelect.value;
      const filtered = state.sessions.filter((s) => {
        if (program && s.programId !== program) return false;
        if (child && !(s.childName || '').toLowerCase().includes(child)) return false;
        return true;
      });
      renderSessionsList(list, filtered);
    };

    filterChild.addEventListener('input', refresh);
    programSelect.addEventListener('change', refresh);
    await refresh();
  }

  function renderSessionsList(container, sessions) {
    container.innerHTML = '';
    if (!sessions.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhuma sessao registrada ainda. Use "Nova sessao" para comecar.';
      container.appendChild(empty);
      return;
    }
    sessions.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.innerHTML = `
        <div class="info">
          <h4>${escapeHtml(s.childName || '(sem nome)')}<span class="badge">${escapeHtml(s.programName || s.programId)}</span></h4>
          <span>${fmtDate(s.date)} · Passo: ${escapeHtml(s.step || '-')} · Terapeuta: ${escapeHtml(s.therapists || '-')}</span>
        </div>
        <div>
          <button class="open">Abrir</button>
        </div>
      `;
      item.querySelector('.open').addEventListener('click', () => {
        navigate('session', { id: s.id });
      });
      container.appendChild(item);
    });
  }

  // ----- View: Nova sessao -----
  function renderNew() {
    const node = fillTemplate('tpl-new');
    app.appendChild(node);

    const form = document.getElementById('newSessionForm');
    const programSelect = form.elements.programId;
    const programDesc = document.getElementById('programDesc');
    const stimuliFs = document.getElementById('stimuliFieldset');

    if (!state.programs.length) {
      programDesc.textContent = 'Nao foi possivel carregar a lista de programas. Verifique a conexao com o servidor.';
      return;
    }

    state.programs.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      programSelect.appendChild(opt);
    });

    form.elements.date.value = new Date().toISOString().slice(0, 10);

    const updateProgramFields = () => {
      const p = state.programsById[programSelect.value];
      programDesc.textContent = p ? p.description || '' : '';
      stimuliFs.innerHTML = '<legend>Estimulos</legend>';
      if (!p) return;
      for (let i = 1; i <= p.stimulusCount; i++) {
        const lbl = document.createElement('label');
        lbl.innerHTML = `Estimulo ${i} <input type="text" name="stimulus_${i}" />`;
        stimuliFs.appendChild(lbl);
      }
    };

    programSelect.addEventListener('change', updateProgramFields);
    if (state.programs.length) {
      programSelect.value = state.programs[0].id;
      updateProgramFields();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!programSelect.value) {
        alert('Selecione um programa.');
        return;
      }
      const fd = new FormData(form);
      const programId = fd.get('programId');
      const program = state.programsById[programId];
      const stimuli = [];
      for (let i = 1; i <= (program ? program.stimulusCount : 0); i++) {
        stimuli.push(fd.get('stimulus_' + i) || '');
      }
      try {
        const session = await api('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            programId,
            childName: fd.get('childName'),
            date: fd.get('date'),
            step: fd.get('step'),
            therapists: fd.get('therapists'),
            stimuli
          })
        });
        navigate('session', { id: session.id });
      } catch (err) {
        alert('Erro ao criar sessao: ' + err.message);
      }
    });
  }

  // ----- View: Sessao (preencher) -----
  async function renderSession(id) {
    state.currentSessionId = id;
    const node = fillTemplate('tpl-session');
    app.appendChild(node);

    let session;
    try {
      session = await api('/api/sessions/' + id);
    } catch (err) {
      app.innerHTML = `<div class="empty">Sessao nao encontrada.</div>`;
      return;
    }
    const program = state.programsById[session.programId];
    if (!program) {
      app.innerHTML = `<div class="empty">Programa "${escapeHtml(session.programId)}" nao encontrado.</div>`;
      return;
    }

    document.getElementById('sessionTitle').textContent =
      `${program.title} - ${session.childName || '(sem nome)'}`;
    document.getElementById('sessionMeta').textContent =
      `Criada em ${new Date(session.createdAt).toLocaleString('pt-BR')}` +
      (session.updatedAt && session.updatedAt !== session.createdAt
        ? ` · Atualizada em ${new Date(session.updatedAt).toLocaleString('pt-BR')}`
        : '');

    // Cabecalho editavel
    const headerForm = document.getElementById('headerForm');
    headerForm.elements.childName.value = session.childName || '';
    headerForm.elements.date.value = session.date || '';
    headerForm.elements.step.value = session.step || '';
    headerForm.elements.therapists.value = session.therapists || '';
    const stimuliEdit = document.getElementById('stimuliFieldsetEdit');
    stimuliEdit.innerHTML = '<legend>Estimulos</legend>';
    for (let i = 0; i < program.stimulusCount; i++) {
      const lbl = document.createElement('label');
      lbl.innerHTML = `Estimulo ${i + 1} <input type="text" name="stimulus_${i + 1}" value="${escapeHtml((session.stimuli && session.stimuli[i]) || '')}" />`;
      stimuliEdit.appendChild(lbl);
    }

    // Tabela de tentativas
    const wrap = document.getElementById('trialsTableWrap');
    wrap.innerHTML = '';
    const table = buildTrialsTable(program, session.trials);
    wrap.appendChild(table);

    const summaryCard = document.getElementById('summaryCard');
    const summaryArea = document.getElementById('summaryArea');
    const renderSummaryFromState = () => {
      summaryArea.innerHTML = '';
      summaryArea.appendChild(buildSummaryView(program, session.trials));
    };
    renderSummaryFromState();
    if (!program.hasSummary) {
      // Mesmo sem o resumo no PDF original, ainda eh util mostrar a contagem.
      summaryCard.querySelector('h3').textContent = 'Contagem (auxiliar)';
    }

    // Atualiza resumo ao vivo conforme troca selects
    wrap.addEventListener('change', renderSummaryFromState);

    // Salvar
    document.getElementById('btnSave').addEventListener('click', async () => {
      const trials = collectTrials(program, table);
      const stimuli = [];
      for (let i = 1; i <= program.stimulusCount; i++) {
        stimuli.push(headerForm.elements['stimulus_' + i].value || '');
      }
      try {
        const updated = await api('/api/sessions/' + session.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            childName: headerForm.elements.childName.value,
            date: headerForm.elements.date.value,
            step: headerForm.elements.step.value,
            therapists: headerForm.elements.therapists.value,
            stimuli,
            trials
          })
        });
        session.trials = updated.trials;
        renderSummaryFromState();
        flash('Sessao salva.');
      } catch (err) {
        alert('Erro ao salvar: ' + err.message);
      }
    });

    document.getElementById('btnDelete').addEventListener('click', async () => {
      if (!confirm('Excluir esta sessao? Essa acao nao pode ser desfeita.')) return;
      try {
        await api('/api/sessions/' + session.id, { method: 'DELETE' });
        navigate('home');
      } catch (err) {
        alert('Erro ao excluir: ' + err.message);
      }
    });
  }

  function buildTrialsTable(program, trials) {
    const table = document.createElement('table');
    table.className = 'trials-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.innerHTML = '<th>#</th>';
    program.positions.forEach((pos) => {
      headRow.innerHTML += `<th class="position">${pos}</th>`;
    });
    program.responseFields.forEach((f) => {
      headRow.innerHTML += `<th>${escapeHtml(f.shortLabel || f.label)}</th>`;
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    trials.forEach((trial, rowIdx) => {
      const tr = document.createElement('tr');
      tr.dataset.rowIdx = rowIdx;
      tr.innerHTML = `<td class="idx">${trial.index}</td>`;
      program.positions.forEach((pos) => {
        const td = document.createElement('td');
        td.className = 'position';
        td.textContent = trial.cells[pos] != null ? trial.cells[pos] : '';
        if (pos !== 'M' && pos === trial.correctPosition) {
          td.classList.add('correct');
        }
        tr.appendChild(td);
      });
      program.responseFields.forEach((field) => {
        const td = document.createElement('td');
        td.className = 'response';
        const select = document.createElement('select');
        select.dataset.field = field.key;
        select.innerHTML = '<option value="">-</option>';
        field.options.forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = `${o.value} - ${o.label}`;
          select.appendChild(opt);
        });
        select.value = (trial.responses && trial.responses[field.key]) || '';
        td.appendChild(select);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function collectTrials(program, table) {
    const rows = table.querySelectorAll('tbody tr');
    const trials = [];
    rows.forEach((tr, rowIdx) => {
      const cells = {};
      const tds = tr.querySelectorAll('td.position');
      program.positions.forEach((pos, i) => {
        const v = tds[i].textContent.trim();
        cells[pos] = v ? Number(v) : null;
      });
      const responses = {};
      tr.querySelectorAll('select').forEach((sel) => {
        responses[sel.dataset.field] = sel.value;
      });
      const comparisonPositions = program.positions.slice(1);
      const correctPosition =
        comparisonPositions.find((p) => cells[p] === cells.M) || null;
      trials.push({
        index: rowIdx + 1,
        cells,
        correctPosition,
        responses
      });
    });
    return trials;
  }

  function buildSummaryView(program, trials) {
    const wrap = document.createElement('div');
    wrap.className = 'summary-grid';
    program.responseFields.forEach((field) => {
      let independentes = 0;
      let comDica = 0;
      let outras = 0;
      let semResposta = 0;
      trials.forEach((t) => {
        const v = (t.responses && t.responses[field.key]) || '';
        if (!v) return semResposta++;
        if (field.correctIndependent && field.correctIndependent.includes(v)) return independentes++;
        if (field.correctWithHelp && field.correctWithHelp.includes(v)) return comDica++;
        outras++;
      });
      const total = trials.length;
      const corretas = independentes + comDica;
      const pct = (n) => total ? Math.round((n / total) * 100) + '%' : '-';
      const box = document.createElement('div');
      box.className = 'summary-box';
      box.innerHTML = `
        <h4>${escapeHtml(field.label)}</h4>
        <ul>
          <li><span>Independentes</span><strong>${independentes} <span class="pct">${pct(independentes)}</span></strong></li>
          <li><span>Com dica</span><strong>${comDica} <span class="pct">${pct(comDica)}</span></strong></li>
          <li><span>Total corretas</span><strong>${corretas} <span class="pct">${pct(corretas)}</span></strong></li>
          <li><span>Outras / incorretas</span><strong>${outras}</strong></li>
          <li><span>Sem resposta</span><strong>${semResposta}</strong></li>
        </ul>
      `;
      wrap.appendChild(box);
    });
    return wrap;
  }

  // ----- View: Evolucao -----
  async function renderEvolution() {
    const node = fillTemplate('tpl-evolution');
    app.appendChild(node);
    const childSel = document.getElementById('evoChild');
    const programSel = document.getElementById('evoProgram');

    state.sessions = await api('/api/sessions');
    const children = Array.from(new Set(state.sessions.map((s) => s.childName).filter(Boolean))).sort();
    children.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      childSel.appendChild(opt);
    });
    state.programs.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      programSel.appendChild(opt);
    });
    if (children.length) childSel.value = children[0];
    if (state.programs.length) programSel.value = state.programs[0].id;

    const refresh = () => drawEvolution(childSel.value, programSel.value);
    childSel.addEventListener('change', refresh);
    programSel.addEventListener('change', refresh);
    refresh();
  }

  function drawEvolution(childName, programId) {
    const chartWrap = document.getElementById('evoChartWrap');
    const tableWrap = document.getElementById('evoTableWrap');
    chartWrap.innerHTML = '';
    tableWrap.innerHTML = '';
    if (!childName || !programId) {
      chartWrap.innerHTML = '<div class="empty">Selecione crianca e programa.</div>';
      return;
    }
    const program = state.programsById[programId];
    const filtered = state.sessions
      .filter((s) => s.childName === childName && s.programId === programId)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!filtered.length) {
      chartWrap.innerHTML = '<div class="empty">Sem sessoes para esta combinacao.</div>';
      return;
    }

    // Para o grafico, usamos o primeiro responseField como indicador.
    const field = program.responseFields[0];
    const points = filtered.map((s) => {
      let ind = 0, help = 0, err = 0;
      const trials = s.trials || [];
      trials.forEach((t) => {
        const v = (t.responses && t.responses[field.key]) || '';
        if (!v) return;
        if (field.correctIndependent && field.correctIndependent.includes(v)) ind++;
        else if (field.correctWithHelp && field.correctWithHelp.includes(v)) help++;
        else err++;
      });
      const total = trials.length || 1;
      return {
        date: s.date,
        ind: (ind / total) * 100,
        help: (help / total) * 100,
        err: (err / total) * 100,
        indCount: ind,
        helpCount: help,
        errCount: err,
        total: trials.length,
        sessionId: s.id
      };
    });

    chartWrap.appendChild(buildLegend());
    chartWrap.appendChild(buildSvgChart(points, field));

    // Tabela
    const tbl = document.createElement('table');
    tbl.className = 'trials-table';
    tbl.innerHTML = `
      <thead>
        <tr>
          <th>Data</th><th>Independentes</th><th>Com dica</th><th>Outras</th><th>Total</th><th>% Corretas</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tbl.querySelector('tbody');
    points.forEach((p) => {
      const corretasPct = p.total ? Math.round(((p.indCount + p.helpCount) / p.total) * 100) : 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(p.date)}</td>
        <td>${p.indCount}</td>
        <td>${p.helpCount}</td>
        <td>${p.errCount}</td>
        <td>${p.total}</td>
        <td>${corretasPct}%</td>
      `;
      tbody.appendChild(tr);
    });
    tableWrap.appendChild(tbl);
  }

  function buildLegend() {
    const div = document.createElement('div');
    div.className = 'legend';
    div.innerHTML = `
      <span><span class="swatch" style="background: var(--green)"></span>Independentes</span>
      <span><span class="swatch" style="background: var(--yellow)"></span>Com dica</span>
      <span><span class="swatch" style="background: var(--red)"></span>Outras / incorretas</span>
    `;
    return div;
  }

  function buildSvgChart(points, field) {
    const W = 720, H = 280, P = 36;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const innerW = W - P * 2;
    const innerH = H - P * 2;

    // Eixo Y (0..100)
    for (let i = 0; i <= 4; i++) {
      const y = P + (innerH * i) / 4;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('class', 'grid');
      line.setAttribute('x1', P); line.setAttribute('x2', W - P);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      svg.appendChild(line);
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', 4); txt.setAttribute('y', y + 4);
      txt.textContent = (100 - i * 25) + '%';
      svg.appendChild(txt);
    }

    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const xOf = (i) => P + (points.length === 1 ? innerW / 2 : i * stepX);
    const yOf = (pct) => P + innerH - (pct / 100) * innerH;

    const drawLine = (cls, key) => {
      let d = '';
      points.forEach((p, i) => {
        const x = xOf(i);
        const y = yOf(p[key]);
        d += (i === 0 ? 'M' : 'L') + x + ',' + y + ' ';
      });
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('class', cls);
      path.setAttribute('d', d.trim());
      svg.appendChild(path);
    };
    const drawDots = (cls, key) => {
      points.forEach((p, i) => {
        const c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('class', cls);
        c.setAttribute('cx', xOf(i));
        c.setAttribute('cy', yOf(p[key]));
        c.setAttribute('r', 3.5);
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = `${fmtDate(p.date)} - ${Math.round(p[key])}%`;
        c.appendChild(title);
        svg.appendChild(c);
      });
    };

    drawLine('line-ind', 'ind');
    drawLine('line-help', 'help');
    drawLine('line-err', 'err');
    drawDots('dot-ind', 'ind');
    drawDots('dot-help', 'help');
    drawDots('dot-err', 'err');

    // Rotulos do eixo X
    points.forEach((p, i) => {
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', xOf(i));
      txt.setAttribute('y', H - 8);
      txt.setAttribute('text-anchor', 'middle');
      txt.textContent = fmtDate(p.date);
      svg.appendChild(txt);
    });

    // Titulo
    const title = document.createElementNS(svgNS, 'text');
    title.setAttribute('x', W / 2);
    title.setAttribute('y', 14);
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('fill', '#1f2937');
    title.style.fontWeight = '600';
    title.textContent = `Evolucao - ${field.shortLabel || field.label}`;
    svg.appendChild(title);

    return svg;
  }

  // ----- View: Dados (export/import) -----
  function renderData() {
    const node = fillTemplate('tpl-data');
    app.appendChild(node);
    const form = document.getElementById('importForm');
    const result = document.getElementById('importResult');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = form.elements.file.files[0];
      if (!file) return;
      const mode = form.elements.mode.value;
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch (err) {
        result.textContent = 'JSON invalido.';
        return;
      }
      try {
        const r = await api('/api/import?mode=' + encodeURIComponent(mode), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        result.textContent =
          r.mode === 'replace'
            ? `Substituicao concluida. ${r.count} sessoes carregadas.`
            : `Mesclagem concluida. Adicionadas: ${r.added}, atualizadas: ${r.updated}.`;
      } catch (err) {
        result.textContent = 'Erro: ' + err.message;
      }
    });
  }

  // ----- Helpers -----
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function flash(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.cssText = `
      position: fixed; bottom: 16px; right: 16px;
      background: var(--primary); color: #fff;
      padding: 10px 16px; border-radius: 6px; z-index: 100;
      box-shadow: 0 6px 16px rgba(0,0,0,.15); font-size: 14px;
    `;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1800);
  }

  bootstrap();
})();
