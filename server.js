const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listPrograms, getProgram, randomTrials } = require('./programs');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_FILE)) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: [] }, null, 2));
}

function readStore() {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return parsed;
  } catch (err) {
    return { sessions: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2));
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

// Calcula o resumo de uma sessao a partir das tentativas e do programa.
function summarize(session, program) {
  const summary = {};
  program.responseFields.forEach((field) => {
    let independentes = 0;
    let comDica = 0;
    let incorretasComDica = 0;
    let incorretasSemDica = 0;
    let semResposta = 0;

    session.trials.forEach((trial) => {
      const value = (trial.responses && trial.responses[field.key]) || '';
      if (!value) {
        semResposta++;
        return;
      }
      if (field.correctIndependent && field.correctIndependent.includes(value)) {
        independentes++;
      } else if (field.correctWithHelp && field.correctWithHelp.includes(value)) {
        comDica++;
      } else if (value === 'X' || value === '-') {
        incorretasSemDica++;
      } else {
        incorretasComDica++;
      }
    });

    summary[field.key] = {
      label: field.shortLabel || field.label,
      independentes,
      comDica,
      incorretasSemDica,
      incorretasComDica,
      semResposta,
      totalCorretas: independentes + comDica,
      totalTentativas: session.trials.length
    };
  });
  return summary;
}

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- API de programas ---
app.get('/api/programs', (req, res) => {
  res.json(listPrograms());
});

app.get('/api/programs/:id', (req, res) => {
  const p = getProgram(req.params.id);
  if (!p) return res.status(404).json({ error: 'Programa nao encontrado' });
  res.json(p);
});

// --- API de sessoes ---
app.get('/api/sessions', (req, res) => {
  const store = readStore();
  const list = store.sessions
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(list);
});

app.get('/api/sessions/:id', (req, res) => {
  const store = readStore();
  const session = store.sessions.find((s) => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Sessao nao encontrada' });
  const program = getProgram(session.programId);
  res.json({
    ...session,
    summary: program ? summarize(session, program) : null
  });
});

app.post('/api/sessions', (req, res) => {
  const { programId, childName, date, step, therapists, stimuli } = req.body || {};
  const program = getProgram(programId);
  if (!program) return res.status(400).json({ error: 'Programa invalido' });

  const session = {
    id: newId(),
    programId,
    programName: program.name,
    childName: (childName || '').trim(),
    date: date || new Date().toISOString().slice(0, 10),
    step: (step || '').trim(),
    therapists: (therapists || '').trim(),
    stimuli: Array.isArray(stimuli)
      ? stimuli.slice(0, program.stimulusCount).map((s) => String(s || '').trim())
      : [],
    trials: randomTrials(program),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const store = readStore();
  store.sessions.push(session);
  writeStore(store);
  res.status(201).json(session);
});

app.put('/api/sessions/:id', (req, res) => {
  const store = readStore();
  const idx = store.sessions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Sessao nao encontrada' });

  const current = store.sessions[idx];
  const program = getProgram(current.programId);
  if (!program) return res.status(400).json({ error: 'Programa invalido' });

  const body = req.body || {};
  const updated = {
    ...current,
    childName: body.childName !== undefined ? String(body.childName).trim() : current.childName,
    date: body.date || current.date,
    step: body.step !== undefined ? String(body.step).trim() : current.step,
    therapists: body.therapists !== undefined ? String(body.therapists).trim() : current.therapists,
    stimuli: Array.isArray(body.stimuli) ? body.stimuli.map((s) => String(s || '').trim()) : current.stimuli,
    trials: Array.isArray(body.trials) ? body.trials : current.trials,
    updatedAt: new Date().toISOString()
  };

  store.sessions[idx] = updated;
  writeStore(store);
  res.json({ ...updated, summary: summarize(updated, program) });
});

app.delete('/api/sessions/:id', (req, res) => {
  const store = readStore();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.id !== req.params.id);
  if (store.sessions.length === before)
    return res.status(404).json({ error: 'Sessao nao encontrada' });
  writeStore(store);
  res.json({ ok: true });
});

// --- Export / Import JSON ---
app.get('/api/export', (req, res) => {
  const store = readStore();
  const filename = `aba-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(store, null, 2));
});

app.post('/api/import', (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.sessions)) {
    return res.status(400).json({ error: 'Arquivo invalido (esperado { sessions: [...] }).' });
  }
  const mode = (req.query.mode || 'merge').toString();
  const store = readStore();

  if (mode === 'replace') {
    writeStore({ sessions: body.sessions });
    return res.json({ ok: true, mode, count: body.sessions.length });
  }

  // merge: adiciona sessoes novas (id ainda nao existente) e atualiza existentes
  const byId = new Map(store.sessions.map((s) => [s.id, s]));
  let added = 0;
  let updated = 0;
  body.sessions.forEach((s) => {
    if (!s || !s.id) return;
    if (byId.has(s.id)) {
      byId.set(s.id, s);
      updated++;
    } else {
      byId.set(s.id, s);
      added++;
    }
  });
  writeStore({ sessions: Array.from(byId.values()) });
  res.json({ ok: true, mode, added, updated });
});

app.listen(PORT, () => {
  console.log(`Draft-Renata rodando em http://localhost:${PORT}`);
});
