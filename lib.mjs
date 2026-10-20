// GPT와 Claude가 각자 답하고, 서로 검토하고, 종합하는 흐름.
// 외부 패키지 없이 Node 18+ 의 fetch 만 사용해요.

const SYSTEM = [
  '당신은 주식·사업·부동산 같은 주제를 다루는 한국어 조언 비서입니다.',
  '모르는 것은 모른다고 말하고, 확실한 내용과 추측을 구분하세요.',
  '최신 시세·법·세금처럼 바뀌는 정보는 확인이 필요하다고 알려 주세요.',
  '특정 종목·매물·계약을 사라 말라 단정하지 말고, 판단 근거와 위험을 설명하세요.',
].join('\n');

export function config(env = process.env) {
  return {
    openaiKey: env.OPENAI_API_KEY,
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiModel: env.OPENAI_MODEL || 'gpt-5',
    claudeModel: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    openaiBase: env.OPENAI_BASE_URL || 'https://api.openai.com',
    anthropicBase: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  };
}

async function post(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function askGpt(cfg, prompt) {
  const data = await post(
    `${cfg.openaiBase}/v1/chat/completions`,
    { authorization: `Bearer ${cfg.openaiKey}` },
    {
      model: cfg.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    },
  );
  return data.choices[0].message.content;
}

export async function askClaude(cfg, prompt) {
  const data = await post(
    `${cfg.anthropicBase}/v1/messages`,
    { 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
    {
      model: cfg.claudeModel,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    },
  );
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

const reviewPrompt = (question, other, name) =>
  `질문:\n${question}\n\n${name}의 답변:\n${other}\n\n` +
  `위 답변을 검토하세요. 사실 오류, 빠진 점, 과한 단정, 위험을 짚고, ` +
  `동의하는 부분도 알려 주세요. 간결하게 항목으로 쓰세요.`;

const synthPrompt = (q, gpt, claude, gptReview, claudeReview) =>
  `질문:\n${q}\n\n[GPT 답변]\n${gpt}\n\n[Claude 답변]\n${claude}\n\n` +
  `[Claude가 GPT 답변을 검토한 내용]\n${claudeReview}\n\n[GPT가 Claude 답변을 검토한 내용]\n${gptReview}\n\n` +
  `위 내용을 종합해 다음 형식으로 쓰세요.\n` +
  `1. 두 비서가 합의한 점\n2. 의견이 갈리는 점과 각자의 근거\n3. 직접 확인해야 할 것\n4. 한 줄 결론`;

// 단계가 끝날 때마다 emit({stage, ...}) 를 호출해요. 한쪽이 실패해도 나머지는 계속 진행해요.
export async function roundtable(question, cfg, emit) {
  const settle = async (fn) => {
    try {
      return { ok: true, text: await fn() };
    } catch (e) {
      return { ok: false, text: `오류: ${e.message}` };
    }
  };

  const [gpt, claude] = await Promise.all([
    settle(() => askGpt(cfg, question)),
    settle(() => askClaude(cfg, question)),
  ]);
  emit({ stage: 'answers', gpt, claude });
  if (!gpt.ok || !claude.ok) {
    emit({ stage: 'done', note: '한쪽 답변을 받지 못해 검토를 건너뛰었어요.' });
    return;
  }

  const [gptReview, claudeReview] = await Promise.all([
    settle(() => askGpt(cfg, reviewPrompt(question, claude.text, 'Claude'))),
    settle(() => askClaude(cfg, reviewPrompt(question, gpt.text, 'GPT'))),
  ]);
  emit({ stage: 'reviews', gptReview, claudeReview });
  if (!gptReview.ok || !claudeReview.ok) {
    emit({ stage: 'done', note: '검토 중 오류가 나서 종합을 건너뛰었어요.' });
    return;
  }

  const summary = await settle(() =>
    askClaude(cfg, synthPrompt(question, gpt.text, claude.text, gptReview.text, claudeReview.text)),
  );
  emit({ stage: 'summary', summary });
  emit({ stage: 'done' });
}
