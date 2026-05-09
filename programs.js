// Definicoes dos programas pre-cadastrados.
// Cada programa descreve as colunas posicionais (M/E/C/D), a quantidade de
// tentativas, os campos de resposta (com suas opcoes) e se possui resumo.
// Para adicionar um novo programa, basta acrescentar uma entrada em PROGRAMS.

const RESPOSTA_RECEPTIVO = [
  { value: 'AF', label: 'Ajuda Fisica' },
  { value: 'AL', label: 'Ajuda Leve' },
  { value: 'AG', label: 'Ajuda Gestual' },
  { value: '+',  label: 'Independente' }
];

const RESPOSTA_MOTORA = [
  { value: 'AF', label: 'Ajuda Fisica' },
  { value: 'AL', label: 'Ajuda Leve' },
  { value: 'AG', label: 'Ajuda Gestual' },
  { value: 'I',  label: 'Independente' }
];

const RESPOSTA_VERBAL = [
  { value: 'EC',  label: 'Dica ecoica' },
  { value: 'INT', label: 'Dica intraverbal' },
  { value: 'I',   label: 'Independente' }
];

const PROGRAMS = {
  receptivo: {
    id: 'receptivo',
    name: 'Receptivo',
    title: 'Folha de Registro Receptivo',
    description:
      'O terapeuta apresenta o estimulo-modelo (M) e tres comparacoes (E/C/D). ' +
      'Marca o tipo de ajuda dada na resposta da crianca.',
    stimulusCount: 3,
    trialCount: 9,
    positions: ['M', 'E', 'C', 'D'],
    responseFields: [
      {
        key: 'resposta',
        label: 'Resposta (AF, AL, AG, +)',
        shortLabel: 'Resposta',
        options: RESPOSTA_RECEPTIVO,
        // Considera "correta independente" quando o valor for "+".
        correctIndependent: ['+'],
        // Demais valores nao-vazios sao considerados corretos com dica.
        correctWithHelp: ['AF', 'AL', 'AG']
      }
    ],
    hasSummary: false
  },

  contagem: {
    id: 'contagem',
    name: 'Contagem',
    title: 'Folha de Registro - Contagem',
    description:
      'Programa de contagem com duas dimensoes de resposta: motora (RM) e ' +
      'verbal (RV). Inclui resumo de respostas corretas/incorretas.',
    stimulusCount: 3,
    trialCount: 9,
    positions: ['M', 'E', 'C', 'D'],
    responseFields: [
      {
        key: 'rm',
        label: 'Resposta Motora (RM)',
        shortLabel: 'RM',
        options: RESPOSTA_MOTORA,
        correctIndependent: ['I'],
        correctWithHelp: ['AF', 'AL', 'AG']
      },
      {
        key: 'rv',
        label: 'Resposta Verbal (RV)',
        shortLabel: 'RV',
        options: RESPOSTA_VERBAL,
        correctIndependent: ['I'],
        correctWithHelp: ['EC', 'INT']
      }
    ],
    hasSummary: true
  }
};

// Gera tentativas randomizadas: para cada linha sorteia M (1..stimulusCount)
// e uma permutacao dos numeros para as demais posicoes (E/C/D).
function randomTrials(program) {
  const n = program.stimulusCount;
  const positions = program.positions;
  const comparisonPositions = positions.slice(1); // E, C, D
  const trials = [];

  for (let i = 0; i < program.trialCount; i++) {
    const model = 1 + Math.floor(Math.random() * n);

    // Permutacao dos numeros 1..n
    const numbers = Array.from({ length: n }, (_, k) => k + 1);
    for (let k = numbers.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [numbers[k], numbers[j]] = [numbers[j], numbers[k]];
    }

    const cells = { M: model };
    comparisonPositions.forEach((pos, idx) => {
      cells[pos] = numbers[idx];
    });

    // Posicao da resposta correta (a posicao de comparacao cujo valor == M)
    const correctPosition =
      comparisonPositions.find((pos) => cells[pos] === model) || null;

    const responses = {};
    program.responseFields.forEach((field) => {
      responses[field.key] = '';
    });

    trials.push({
      index: i + 1,
      cells,
      correctPosition,
      responses
    });
  }

  return trials;
}

function listPrograms() {
  return Object.values(PROGRAMS).map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    description: p.description
  }));
}

function getProgram(id) {
  return PROGRAMS[id] || null;
}

module.exports = { PROGRAMS, randomTrials, listPrograms, getProgram };
