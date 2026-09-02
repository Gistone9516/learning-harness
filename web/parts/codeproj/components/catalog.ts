// The catalog as the model sees it: component names, one line of purpose each, and one worked
// example. Sending the full TypeScript schema on every call would cost more than the answers, so
// this stays deliberately terse — the parser is tolerant precisely so the prompt can be short.
//
// Subject-agnostic: every line here describes software explanation in general, never a topic.

/** Which components a given answer kind may use, so a short answer stays short. */
export type AnswerKind = "full" | "semi";

const SKELETON = [
  '{"t":"lead","text":"..."} 답변 첫머리 한두 문장',
  '{"t":"answer","text":"..."} 질문에 대한 직접적인 답 한 문장',
  '{"t":"text","text":"..."} 일반 설명 단락',
  '{"t":"list","items":["..."]} 나열',
  '{"t":"steps","items":[{"title":"...","text":"..."}]} 순서가 있는 것',
];

const CODE_LINKED = [
  '{"t":"ref","path":"app/service.py","lines":[12,18],"note":"..."} 코드 위치 참조 (누르면 이동)',
  '{"t":"focus","lines":[12,18],"note":"..."} 지금 보는 파일의 특정 줄을 가리킴',
  '{"t":"signature","sig":"def borrow(book_id: int) -> Loan","params":[{"name":"book_id","desc":"..."}],"returns":"..."} 함수 시그니처',
  '{"t":"io","input":"...","output":"..."} 입력과 출력 형태',
  '{"t":"calls","callers":[{"path":"...","lines":[1,2]}],"callees":[{"path":"..."}]} 호출 관계',
  '{"t":"flow","items":[{"title":"...","text":"...","path":"...","lines":[1,2]}]} 입력에서 출력까지의 경로',
  '{"t":"alt","current":{"title":"...","text":"..."},"other":{"title":"...","text":"..."}} 대안 비교',
];

const CONCEPTS = [
  '{"t":"concept","name":"...","definition":"...","general":"...","industry":"...","here":"..."} 개념 4단 해설',
  '{"t":"tag","names":["..."]} 개념 이름만 짚기',
  '{"t":"terms","items":[{"term":"...","def":"..."}]} 용어 뜻풀이',
  '{"t":"compare","headers":["...","..."],"rows":[["...","..."]]} 비교표 (2열 권장)',
  '{"t":"caution","text":"..."} 함정이나 흔한 오해',
  '{"t":"why","decision":"...","reason":"..."} 설계 의도',
];

const LEARNING = [
  '{"t":"quiz","items":[{"q":"...","a":"..."}]} 확인 질문 (답은 접혀서 표시됨)',
  '{"t":"findit","q":"...","answer":{"path":"...","lines":[1,2]},"hint":"..."} 위치를 직접 짚어보게 하기',
  '{"t":"next","items":[{"label":"...","path":"...","lines":[1,2]}]} 이어서 볼 지점',
  '{"t":"related","items":[{"path":"...","lines":[1,2],"note":"..."}]} 같은 개념이 쓰인 다른 곳',
];

const TRUST = [
  '{"t":"evidence","text":"...","path":"...","lines":[1,2]} 코드에서 확인된 사실과 그 근거 위치',
  '{"t":"uncertain","text":"..."} 단정할 수 없는 부분 (지어내지 말고 이걸로 표시)',
];

const RULES_FULL = [
  "부품 5~6개를 넘기지 마세요. 같은 종류를 3개 넘게 연달아 쓰지 마세요.",
  "코드 위치를 말할 때는 문장에 적지 말고 ref 부품으로 넣으세요. 경로와 줄 번호는 실제 프로젝트의 것이어야 합니다.",
  "확인되지 않은 내용은 uncertain으로 표시하세요. 특히 특정 기업의 내부 구현을 단정하지 마세요.",
];

const RULES_SEMI = [
  "부품 3개 이내로 짧게 답하세요. answer를 반드시 포함하세요.",
  "쓸 수 있는 부품: answer, text, flow, tag, terms, why, ref, focus, signature, related, caution, uncertain.",
  "코드 위치는 ref 부품으로 넣으세요. 확인되지 않은 내용은 uncertain으로 표시하세요.",
];

/**
 * The directive appended to an explanation request. `kind` narrows the catalog: a semi answer is
 * meant to be read at a glance, so it gets the short list and a tighter budget.
 */
export function buildComponentDirective(kind: AnswerKind = "full"): string {
  const parts =
    kind === "semi"
      ? [
          // No `lead`: a semi answer opens with the answer itself. An opening sentence in front
          // of it is the one thing a read-at-a-glance format cannot afford.
          SKELETON[1],
          SKELETON[2],
          ...CODE_LINKED.slice(0, 2),
          CODE_LINKED[2],
          CODE_LINKED[5],
          CONCEPTS[1],
          // `tag` carries names only. The design asks a semi answer to give a concept's name AND
          // a one-line meaning, and `terms` is the block shaped for that.
          CONCEPTS[2],
          CONCEPTS[4],
          CONCEPTS[5],
          LEARNING[3],
          TRUST[1],
        ]
      : [...SKELETON, ...CODE_LINKED, ...CONCEPTS, ...LEARNING, ...TRUST];
  const rules = kind === "semi" ? RULES_SEMI : RULES_FULL;

  return [
    "",
    "[응답 형식]",
    '아래 부품들을 조합한 JSON 하나로만 답하세요: {"blocks":[ ... ]}. JSON 바깥에 어떤 글도 쓰지 마세요.',
    "",
    ...parts,
    "",
    ...rules,
  ].join("\n");
}
