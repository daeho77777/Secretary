# 비서 2명 (Secretary)

질문 하나를 GPT와 Claude에게 동시에 묻고, 서로의 답을 검토하게 한 뒤, 합의점·차이점·확인할 것을 정리해 보여 주는 웹앱이에요.

```
질문 → ① GPT 답변 + Claude 답변 (동시)
     → ② GPT가 Claude를, Claude가 GPT를 검토 (동시)
     → ③ 합의한 점 / 갈리는 점 / 직접 확인할 것 / 한 줄 결론
```

한쪽이 실패하면 나머지 단계는 건너뛰고 알려줘요.

## 실행

Node 18 이상이 필요하고 설치할 패키지는 없어요.

```sh
export OPENAI_API_KEY=...       # OpenAI 키
export ANTHROPIC_API_KEY=...    # Anthropic 키
export APP_PASSWORD=...         # 권장: 접속 비밀번호
npm start                       # http://localhost:3000
npm test
```

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | 없음 | 둘 다 필요해요. 서버에만 두고 코드·GitHub 에는 넣지 마세요. |
| `APP_PASSWORD` | 없음 | 설정하면 질문할 때 비밀번호를 요구해요. 인터넷에 올릴 때는 꼭 설정하세요. 없으면 누구나 내 키로 질문할 수 있어요. |
| `OPENAI_MODEL` | `gpt-5` | 쓰는 OpenAI 모델 이름. 계정에서 쓸 수 있는 이름으로 바꾸세요. |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | 쓰는 Claude 모델 이름 |
| `PORT` | `3000` | |

## 주의

- 두 모델이 같은 말을 해도 틀릴 수 있어요. 시세·법·세금은 원자료로 확인하세요.
- 질문 내용은 OpenAI 와 Anthropic 서버로 전송돼요. 주민번호·계좌번호 같은 개인정보는 넣지 마세요.
- 한 번 질문에 모델 호출이 5번 일어나서 비용이 들어요.
