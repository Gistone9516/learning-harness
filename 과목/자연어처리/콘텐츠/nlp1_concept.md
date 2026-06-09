---
deck_id: nlp1_concept
subject_id: nlp
title: 1) 개념 — 벡터화·LDA·딥러닝 핵심
unit: nlp-concept
area: written
subarea: computer
schema_version: 1
---

## @nlp-cn-text-to-num
- type: func
- grade_mode: exact
- weight: 8
- answers: 벡터화 | vectorization | 텍스트 벡터화

---FRONT---
컴퓨터는 글자를 그대로 계산할 수 없다. 텍스트를 기계가 계산할 수 있는 숫자 형태로 바꾸는 과정을 무엇이라 하는가?
---BACK---
**벡터화(Vectorization)**

- 글자는 사람이 읽는 것, 숫자는 컴퓨터가 계산하는 것
- 단어나 문장을 숫자 배열(벡터)로 바꿔야 덧셈·곱셈·유사도 계산이 가능
- 예: "나는 학교에 간다" → [0, 1, 0, 0, 2, ...] (단어 빈도 배열)

---

## @nlp-cn-vector-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 벡터 | vector

---FRONT---
여러 숫자를 순서대로 나열한 것으로, 텍스트에서는 문서나 단어를 표현하는 숫자 배열을 뜻하는 것은?
---BACK---
**벡터(Vector)**

- 예: [0, 3, 1, 0, 2] — 5개 숫자가 한 줄로 늘어선 것
- 문서 벡터: 각 숫자 = 해당 단어가 몇 번 나왔는지
- 벡터끼리 더하거나 유사도를 계산할 수 있어 텍스트 분석에 활용

---

## @nlp-cn-matrix-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 행렬 | matrix

---FRONT---
여러 벡터를 세로로 쌓아 만든 표(가로=행, 세로=열)를 무엇이라 하는가? 텍스트 분석에서는 문서마다 한 행을 차지한다.
---BACK---
**행렬(Matrix)**

- 행(row) = 문서 1개 / 열(column) = 단어 1개
- 예: 100개 문서 × 500개 단어 → 100×500 행렬
- 대부분 값이 0인 경우가 많아 "희소 행렬"이라고도 부름

---

## @nlp-cn-token-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 토큰 | token

---FRONT---
텍스트를 분석할 때 쪼개는 최소 단위를 무엇이라 하는가? 보통 단어 하나를 가리킨다.
---BACK---
**토큰(Token)**

- 텍스트를 토큰 단위로 나누는 과정 = 토큰화(tokenization)
- 예: "나는 학교에 간다" → ["나는", "학교에", "간다"] (3개 토큰)
- 단어 단위 외에 문자 단위·음절 단위도 가능

---

## @nlp-cn-corpus-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 말뭉치 | corpus | 코퍼스

---FRONT---
분석에 사용하는 텍스트 데이터 전체 묶음을 무엇이라 부르는가? 예를 들어 서울시 민원 5,000건이 이에 해당한다.
---BACK---
**말뭉치(Corpus)**

- corpus = 라틴어로 "몸(body)", 즉 텍스트의 덩어리
- 모든 문서를 모아놓은 데이터셋 전체를 가리킴
- 예: 뉴스 기사 모음, 민원 문서 모음, 소설 전집

---

## @nlp-cn-bow-def
- type: func
- grade_mode: exact
- weight: 8
- answers: BOW | Bag-of-Words | 백오브워즈

---FRONT---
문서를 단어들의 출현 빈도로만 표현하며, 단어 순서와 문맥을 무시하는 가장 단순한 텍스트 벡터화 모델은?
---BACK---
**BOW (Bag-of-Words, 단어 가방)**

- "가방에 단어를 쏟아 부은 것" — 단어가 몇 개 있는지만 셈
- 순서 무시: "나는 밥을 먹는다"와 "밥을 나는 먹는다"가 같은 벡터
- sklearn에서 `CountVectorizer`로 구현

---

## @nlp-cn-bow-limit
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
다음 두 문장이 BOW 벡터로 구별되지 않는 이유를 BOW 설계 원리에서 설명하라: "나는 개를 물었다" / "개가 나를 물었다"
---BACK---
**단어 순서(어순) 무시**

- BOW는 단어가 몇 번 나왔는지만 세고, 순서는 완전히 버림
- "나", "개", "물었다" 세 단어가 들어있다는 점만 기록 → 두 문장이 같은 벡터
- 문맥과 의미 관계를 담지 못하는 BOW의 근본 한계

---

## @nlp-cn-dtm-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 문서-단어행렬 | DTM | Document-Term Matrix | 문서단어행렬

---FRONT---
행(row)은 문서, 열(column)은 단어, 값은 해당 단어가 그 문서에 등장한 횟수를 담은 행렬의 이름은?
---BACK---
**문서-단어행렬 (DTM, Document-Term Matrix)**

- 예: 100개 문서 × 500개 단어 → 100×500 행렬
- 값 = 빈도: "사랑"이 3번 나온 문서면 그 칸에 3
- 대부분 값이 0 (희소 행렬) — 한 문서에 모든 단어가 다 나올 수는 없으니까

---

## @nlp-cn-stopword-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 불용어 | stop word | stopword

---FRONT---
"그리고", "또는", "있습니다"처럼 너무 자주 나오지만 문서를 구분하는 데 도움이 안 되는 단어들을 무엇이라 하는가?
---BACK---
**불용어(Stop Word)**

- "불용(不用)" = 쓸 필요가 없는
- 이 단어들은 거의 모든 문서에 나오므로 문서를 구별하는 힘이 없음
- 제거하면: 차원이 줄고, 실제 의미 있는 단어에 집중할 수 있음
- sklearn: `CountVectorizer(stop_words=[...])`

---

## @nlp-cn-sparse-matrix
- type: func
- grade_mode: exact
- weight: 7
- answers: 희소 행렬 | sparse matrix | 희소행렬

---FRONT---
DTM에서 값의 대부분이 0인 행렬을 무엇이라 부르는가?
---BACK---
**희소 행렬(Sparse Matrix)**

- 이유: 어휘 사전에는 단어가 수만 개이지만, 한 문서에는 그중 일부만 등장
- 예: 사전 10,000단어 중 한 문서에 실제 나오는 단어는 50~100개 → 나머지는 0
- 희소(sparse) = "드문드문 값이 있다"는 뜻
- 메모리 절약을 위해 0이 아닌 값만 저장하는 특수 형식 사용

---

## @nlp-cn-ngram-def
- type: func
- grade_mode: exact
- weight: 8
- answers: N-gram | 엔그램 | n-gram

---FRONT---
단어 1개짜리 토큰(유니그램)뿐만 아니라 연속된 N개 단어 묶음도 하나의 단위로 보는 방법은? 예: "서울 시청"을 한 단위로 다룸.
---BACK---
**N-gram**

- 유니그램(unigram, N=1): 단어 1개씩 → ["서울", "시청", "앞"]
- 바이그램(bigram, N=2): 연속 2단어 → ["서울 시청", "시청 앞"]
- sklearn: `ngram_range=(1,2)` → 유니그램+바이그램 모두 사용
- 장점: "서울 시청"처럼 붙어야 의미가 사는 표현을 잡아냄

---

## @nlp-cn-tf-def
- type: func
- grade_mode: exact
- weight: 8
- answers: TF | Term Frequency | 단어빈도 | 단어 빈도

---FRONT---
한 문서 안에서 단어가 등장한 횟수를 반영하는 TF-IDF의 항은 무엇이며 그 약어는?
---BACK---
**TF (Term Frequency, 단어빈도)**

- 한 문서 내에서 해당 단어가 등장한 횟수
- 예: "민원" 단어가 한 문서에 5번 나오면 TF = 5
- TF가 높을수록 그 문서에서 그 단어가 중요하다는 신호

---

## @nlp-cn-idf-def
- type: func
- grade_mode: exact
- weight: 8
- answers: IDF | Inverse Document Frequency | 역문서빈도 | 역 문서 빈도

---FRONT---
흔한 단어일수록 값이 작아지는, 단어의 희귀성을 반영하는 TF-IDF의 역수 항의 이름과 약어는?
---BACK---
**IDF (Inverse Document Frequency, 역문서빈도)**

- 어떤 단어가 몇 개 문서에 나오는지의 역수(뒤집은 값)
- 모든 문서에 다 나오는 단어(예: "있다") → IDF 낮음 → 가중치 낮음
- 일부 문서에만 나오는 단어 → IDF 높음 → 가중치 높음
- "역(Inverse)" = 뒤집는다는 뜻

---

## @nlp-cn-tfidf-def
- type: func
- grade_mode: exact
- weight: 9
- answers: TF-IDF | TFIDF

---FRONT---
모든 문서에 흔한 단어의 가중치는 낮추고, 특정 문서에만 자주 나오는 단어의 가중치는 높이는 벡터화 기법은?
---BACK---
**TF-IDF (Term Frequency–Inverse Document Frequency)**

- TF(이 문서에서 얼마나 자주) × IDF(얼마나 특별한 단어인지) = TF-IDF
- "있습니다"처럼 흔한 단어 → IDF 낮음 → TF-IDF 낮음
- "형사사건"처럼 특정 문서에만 나오는 단어 → IDF 높음 → TF-IDF 높음
- sklearn: `TfidfVectorizer`

---

## @nlp-cn-tfidf-cloze-idf
- type: cloze
- weight: 7

---FRONT---
TF-IDF = {{TF}} × {{IDF}}
---BACK---
- **TF (Term Frequency)**: 한 문서 내 단어 등장 빈도 — 많이 나올수록 그 문서에서 중요
- **IDF (Inverse Document Frequency)**: 그 단어가 등장한 문서 수의 역수 기반 — 흔할수록 작아짐
- TF-IDF = TF × IDF: 이 문서에서 자주 나오면서도 다른 문서에는 드문 단어에 높은 값

---

## @nlp-cn-count-vs-tfidf
- type: judge
- grade_mode: exact
- weight: 8
- answers: Count | CountVectorizer | 빈도 행렬

---FRONT---
LDA 토픽 모델링은 단어의 정수 빈도를 기반으로 확률을 추정하는 모델이다. 따라서 TF-IDF 행렬이 아니라 어떤 행렬을 입력으로 써야 하는가?
---BACK---
**Count(빈도) 행렬 — CountVectorizer 결과**

- LDA는 "이 단어가 몇 번 나왔느냐"라는 정수 빈도에 기반
- TF-IDF는 가중치가 들어간 실수값이라 LDA의 빈도 가정과 어긋남
- 역할 분담: **LDA = Count** / **코사인 유사도 = TF-IDF**

---

## @nlp-cn-cosine-def
- type: func
- grade_mode: exact
- weight: 9
- answers: 코사인 유사도 | cosine similarity

---FRONT---
두 벡터의 방향 유사성을 재는 척도로, 문서 길이에 영향을 덜 받아 텍스트 유사도 비교에 자주 쓰이는 방법은?
---BACK---
**코사인 유사도(Cosine Similarity)**

- 두 벡터가 이루는 각도의 코사인 값 (0~1, 1에 가까울수록 유사)
- 벡터 크기(문서 길이)가 아닌 방향(단어 구성 비율)을 비교
- 비유: 두 사람이 같은 방향을 바라본다면 비슷한 내용의 문서

---

## @nlp-cn-cosine-why-length
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
코사인 유사도가 문서 길이에 덜 민감한 이유를 유클리드 거리와 비교해 설명하라.
---BACK---
**벡터의 방향(각도)**

- (유클리드 거리: 두 점 사이의 직선 거리, 숫자 크기 차이 자체를 잼)
- 코사인 = 각도의 코사인값 → 크기는 지워지고 방향만 남음
- 짧은 문서든 긴 문서든 단어 구성 비율이 비슷하면 유사하다고 판단
- 유클리드 거리는 크기 차이까지 포함 → 긴 문서가 무조건 멀어 보임

---

## @nlp-cn-cosine-self
- type: func
- grade_mode: exact
- weight: 7
- answers: 1 | 1.0

---FRONT---
코사인 유사도로 자기 자신과의 유사도를 계산하면 항상 몇이 나오는가?
---BACK---
**1 (= 1.0)**

- 자기 자신 비교 → 완전히 같은 벡터 → 각도 0° → cos(0°) = 1
- 실제 분석에서 유사 문서를 찾으면 0번 문서가 1.0으로 1등
- 그래서 진짜 유사 문서는 1등을 제외한 2등부터 본다

---

## @nlp-cn-cosine-vs-euclidean
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
유클리드 거리는 두 점의 절대적 거리를 재지만, 코사인 유사도는 무엇을 재는가? 텍스트에서 코사인이 더 적합한 이유를 한 문장으로 답하라.
---BACK---
**두 벡터의 방향(패턴)의 유사성을 잰다**

- 유클리드: 긴 문서는 단어 수 자체가 많아 거리가 멀어 보임
- 코사인: 단어 구성 비율이 비슷하면 길이가 달라도 유사하다고 판단
- → 길이가 제각각인 텍스트 비교에는 코사인이 더 공정

---

## @nlp-cn-supervised-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 지도 학습 | supervised learning | 지도학습

---FRONT---
모델에게 입력(X)과 정답 라벨(y)을 함께 주어 "이 입력에 이 정답"이라는 관계를 학습시키는 방식은?
---BACK---
**지도 학습(Supervised Learning)**

- 선생님이 답을 알려주며 가르치는 것처럼 → "지도"
- 예: 문서(X)와 카테고리(y="행정") 쌍으로 분류기 학습
- 정답 라벨이 있어야 함 — 없으면 비지도 학습

---

## @nlp-cn-unsupervised-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 비지도 학습 | unsupervised learning | 비지도학습

---FRONT---
정답 라벨 없이 데이터의 구조·패턴만으로 스스로 그룹이나 토픽을 찾아내는 학습 방식은?
---BACK---
**비지도 학습(Unsupervised Learning)**

- 정답을 알려주지 않고 알아서 패턴을 발견 → "비지도"
- 예: LDA — 민원 문서에서 정답 없이 스스로 토픽을 발견
- 클러스터링(군집화)도 비지도 학습의 한 종류

---

## @nlp-cn-lda-def
- type: func
- grade_mode: exact
- weight: 9
- answers: LDA | 잠재디리클레할당 | 잠재 디리클레 할당 | Latent Dirichlet Allocation

---FRONT---
정답 라벨 없이 단어 분포만으로 문서에 숨어 있는 주제(토픽)를 찾아내는 비지도 학습 기법은?
---BACK---
**LDA (Latent Dirichlet Allocation, 잠재 디리클레 할당)**

- "잠재(Latent)" = 숨어있는 / "토픽"은 드러나지 않은 주제
- 각 문서 = 여러 토픽의 혼합으로 이루어진다고 가정
- sklearn: `LatentDirichletAllocation(n_components=k)`
- 입력: CountVectorizer의 빈도 행렬 (TF-IDF 아님)

---

## @nlp-cn-lda-doc-topic
- type: judge
- grade_mode: exact
- weight: 7
- answers: 여러 토픽의 혼합 | 토픽 혼합 | 혼합

---FRONT---
LDA는 하나의 문서가 오직 한 토픽으로만 이루어진다고 가정하는가? 아니라면 어떻게 가정하는가?
---BACK---
**한 문서는 여러 토픽의 혼합으로 이루어진다고 가정**

- 예: 민원 문서 하나가 "교통(70%) + 환경(30%)" 토픽으로 구성될 수 있음
- 각 토픽은 단어들의 확률 분포로 표현됨 (예: "지하철"·"버스"·"교통" 높은 확률)
- 이 혼합 비율을 역으로 추정하는 것이 LDA의 핵심

---

## @nlp-cn-lda-topic-count
- type: judge
- grade_mode: exact
- weight: 7
- answers: n_components | 토픽 수 | n_components=10

---FRONT---
LDA에서 "몇 개의 토픽으로 나눌지"를 지정하는 sklearn 파라미터 이름은? 값을 너무 크게 하면 비슷한 토픽이 쪼개지고, 너무 작으면 다른 주제가 뭉친다.
---BACK---
**n_components**

- `LatentDirichletAllocation(n_components=10)` → 토픽 10개로 나눔
- 보통 실제 카테고리 수를 참고해 설정 (민원 10종이면 10으로)
- 적정값 찾기: 여러 값으로 실험 후 해석 가장 잘 되는 수 선택

---

## @nlp-cn-lda-random-state
- type: cloze
- weight: 7

---FRONT---
LDA에서 토픽 수는 파라미터 {{n_components}}로 지정하며, 매 실행마다 결과가 달라지지 않도록 {{random_state}}를 고정한다.
---BACK---
- **`n_components`**: 찾을 토픽 수. 실제 카테고리 수를 참고해 설정
- **`random_state`**: 시드 고정 → 재현성 확보. 값 자체(42 등)에 의미 없음
- 토픽 수가 너무 적으면 서로 다른 주제가 뭉치고, 너무 많으면 유사 주제가 쪼개짐

---

## @nlp-cn-onehot-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 원-핫 인코딩 | 원핫 인코딩 | one-hot encoding | 원-핫

---FRONT---
범주형 정답을 클래스 수만큼 열을 만들어 해당 위치만 1, 나머지는 0으로 표현하는 인코딩 방법은? 예: 행정=[0,0,1]
---BACK---
**원-핫 인코딩(One-Hot Encoding)**

- "원-핫(One-Hot)" = 딱 하나만 뜨겁다(=1), 나머지는 차갑다(=0)
- 클래스 간 크기 관계(순서)가 없음을 보장
- pandas: `pd.get_dummies(y)` 사용
- (나중에 배울 출력층 설정과 연결됨)

---

## @nlp-cn-onehot-vs-label
- type: judge
- grade_mode: exact
- weight: 7
- answers: 순서 | 크기 관계 | 순서 의미

---FRONT---
"행정=0, 경제=1, 복지=2"처럼 정수 라벨로 인코딩하면, 모델이 잘못 학습할 수 있는 이유는?
---BACK---
**모델이 정수 크기를 순서/크기 관계로 오해할 수 있음**

- "복지(2) > 경제(1) > 행정(0)"이라는 수치 관계가 생겨버림
- 행정·경제·복지는 크기 관계가 없는 카테고리인데 숫자가 거짓 정보를 줌
- 원-핫은 세 카테고리를 동등하게 표현 → 순서 오해 없음

---

## @nlp-cn-train-test-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 일반화 | 일반화 평가 | generalization

---FRONT---
처음 보는 새 데이터에서도 잘 작동하는 성질을 무엇이라 하는가?
---BACK---
**일반화(Generalization) 평가를 위해 train/test를 분리**

- 같은 데이터로 학습·평가하면 "외운 것을 다시 맞히는" 셈 → 성능이 부풀려짐
- 학습에 안 쓴 test 데이터로만 평가해야 실제 실력을 알 수 있음
- sklearn: `train_test_split(X, y, test_size=0.2)`

---

## @nlp-cn-overfit-def
- type: func
- grade_mode: exact
- weight: 9
- answers: 과적합 | overfitting | 오버피팅

---FRONT---
모델이 학습 데이터를 외워버려 새 데이터에는 잘 맞히지 못하는 현상을 무엇이라 하는가?
---BACK---
**과적합(Overfitting)**

- 마치 시험 문제만 달달 외운 학생 — 조금 다른 문제가 나오면 틀림
- 진단: train 성능 ≫ validation(검증) 성능
- validation(검증)=학습 중 성능 확인에 쓰는 별도 데이터 묶음(test와 별개)
- (train 데이터의 일부를 다시 뗀 것 — model.fit의 validation_split=0.2로 자동 분리)
- 예: 학습 정확도 0.96, 검증 정확도 0.67 → 과적합
- 개선: 드롭아웃(뉴런 무작위로 끄기), 배치정규화(층 간 값 분포 고르기), 조기종료(개선 멈추면 학습 중단), 데이터 증강(학습 데이터 늘리기) — 각각 뒤 카드에서 상세

---

## @nlp-cn-class-imbalance-def
- type: judge
- grade_mode: exact
- weight: 7
- answers: 클래스 불균형 | class imbalance | 불균형 데이터

---FRONT---
분류 모델 학습 시 한 클래스가 다른 클래스보다 훨씬 많은 샘플을 가질 때 모델이 다수 클래스에 쏠려 소수 클래스를 거의 못 맞히는 현상의 원인은?
---BACK---
**클래스 불균형(Class Imbalance)**

- 예: 행정 2,000건 / 여성가족 13건 → 모델이 "무조건 행정" 예측만 해도 높은 정확도
- 소수 클래스는 학습 기회 자체가 적어 모델이 제대로 배우지 못함
- 대응: 데이터 많은 클래스만 선택, stratify 옵션(train_test_split의 stratify 파라미터)(이 실습 범위 아님: 오버샘플링)

---

## @nlp-cn-stratify-def
- type: func
- grade_mode: exact
- weight: 8
- answers: stratify | 계층적 샘플링 | stratified sampling

---FRONT---
`train_test_split`에서 클래스 불균형 데이터를 학습/테스트로 나눌 때, 각 클래스 비율이 원래 분포와 동일하게 유지되도록 하는 파라미터는?
---BACK---
**stratify (계층적 샘플링)**

- `train_test_split(X, y, stratify=y)` 설정
- 효과: 학습·테스트 세트의 클래스 비율을 원래 데이터와 동일하게 유지
- 미설정 시: 운이 나쁘면 한쪽에 특정 클래스가 몰려 평가 왜곡
- 확인: `y_train.mean()`과 `y_test.mean()` 비교

---

## @nlp-cn-neuron-layer
- type: func
- grade_mode: exact
- weight: 8
- answers: 신경망 | 인공신경망 | neural network

---FRONT---
인간의 뇌 신경세포(뉴런)에서 영감을 받아, 여러 뉴런을 층(layer)으로 쌓아 입력을 받아 출력을 내는 계산 구조는?
---BACK---
**인공 신경망(Neural Network)**

- 뉴런 1개: 여러 숫자를 받아 곱하고(가중치) 더한 뒤 하나의 숫자로 압축하는 계산 단위 (입력→곱하기→더하기)
- 활성화함수는 다음 카드(@nlp-cn-relu-def)에서 다룸
- 층(layer): 뉴런 여러 개를 한 줄로 묶은 것
- 여러 층을 쌓으면 → 딥러닝(Deep Learning)
- 가중치(weight): 각 연결의 중요도. 손실이 작아지는 방향으로 반복 수정됨 — 상세는 @nlp-cn-gradient-descent

---

## @nlp-cn-relu-def
- type: func
- grade_mode: exact
- weight: 8
- answers: relu | ReLU | 렐루

---FRONT---
신경망 은닉층에서 가장 많이 쓰이는 활성화함수로, 음수 입력은 0으로, 양수 입력은 그대로 통과시키는 함수는?
---BACK---
**ReLU (Rectified Linear Unit)**

- 공식: 출력 = max(0, 입력)
- 음수를 0으로 꺾어 비선형성을 만든다 → 이게 없으면 아무리 층을 많이 쌓아도 입력에 가중치 곱하고 더하는 동작만 반복 → 결국 직선(선형) 변환 하나와 같아져 복잡한 패턴을 학습할 수 없음
- 선형이 왜 문제인가: 어떤 함수도 직선으로는 구불구불한 데이터의 경계를 나눌 수 없음
- 예: 스팸/정상 메일 경계가 직선 하나로 안 그어질 때 — 굽은 경계를 학습하려면 비선형 함수 필요
- 깊은 신경망에서도 학습 신호가 잘 전달됨(이유는 @nlp-cn-vanishing-def 참조)
- keras: `Dense(units=16, activation='relu')`

---

## @nlp-cn-relu-why
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
은닉층에 relu 같은 비선형 활성화함수가 없으면 층을 아무리 쌓아도 직선 변환 하나와 같아진다. 왜 비선형성이 필요한지 설명하라.
---BACK---
**비선형성 필요 이유**

- 복잡한 분류 경계는 직선(선형 변환)으로 분리 불가 — 실제 데이터는 구불구불한 경계를 가짐
- relu의 max(0,x)가 음수를 꺾어 비선형성 부여 → 여러 층을 쌓으면 복잡한 곡면 경계 표현 가능
- 비선형 없이 층을 쌓으면: W3(W2(W1·x)) = W_통합·x → 결국 선형 변환 1개와 동일
- 깊은 망에서 기울기 소실 완화: relu는 양수 구간에서 기울기=1로 일정 → vanishing 억제

---

## @nlp-cn-softmax-def
- type: func
- grade_mode: exact
- weight: 9
- answers: softmax | 소프트맥스

---FRONT---
다중분류 출력층에서 여러 뉴런의 출력값을 합이 1인 확률 분포로 변환해 "가장 확률이 높은 클래스"를 선택할 수 있게 하는 활성화 함수는?
---BACK---
**softmax**

- 출력이 3개 클래스라면 → [0.1, 0.7, 0.2] 형태 (합=1)
- 가장 큰 값 = 모델이 가장 확신하는 클래스
- 출력층 뉴런 수 = 클래스 수 (n_class)
- 짝: `softmax` + `categorical_crossentropy` (원-핫 정답)

---

## @nlp-cn-rnn-why
- type: func
- grade_mode: exact
- weight: 8
- answers: RNN | Recurrent Neural Network | 순환 신경망

---FRONT---
문장에서 단어 순서가 의미를 결정할 때, BOW처럼 순서를 버리지 않고 처리하는 신경망 계열은?
---BACK---
**RNN (Recurrent Neural Network, 순환 신경망)**

- 순서(시퀀스) 데이터 전용 — 앞의 단어를 기억하며 다음 단어를 처리
- "순환(Recurrent)" = 이전 출력을 다음 입력으로 넣는 구조
- 시점(time step): 단어 하나를 처리하는 1회 순환 단계. 문장 길이 = 시점 수
- 텍스트, 음성, 시계열 등 순서 있는 데이터에 적합
- 예: 나는 개를 물었다 vs 개가 나를 물었다 — BOW는 동일 벡터, RNN은 구별

---

## @nlp-cn-tokenizer-def
- type: func
- grade_mode: exact
- weight: 8
- answers: Tokenizer | keras.Tokenizer

---FRONT---
케라스에서 단어에 빈도순 정수 인덱스를 부여하는 전처리 클래스 이름은?
---BACK---
**정수 인코딩 (Tokenizer)**

- 예: {"민원":1, "서울":2, "행정":3, ...} 사전 구축 → "서울 민원" → [2, 1]
- `Tokenizer(num_words=vocab_size, oov_token="<oov>")`
- `fit_on_texts(X_train)` → 단어 사전 구축 (train에만!)
- `texts_to_sequences(X)` → 문장을 정수 리스트로 변환

---

## @nlp-cn-tokenizer-fit-train
- type: judge
- grade_mode: exact
- weight: 8
- answers: 데이터 누수 | data leakage | 누수 방지

---FRONT---
Tokenizer의 `fit_on_texts`를 train 데이터에만 적용하고 test에는 적용하지 않는 이유는?
---BACK---
**데이터 누수(Data Leakage) 방지**

- test 데이터도 fit에 쓰면 모델이 시험 정보를 미리 본 셈
- 그러면 시험(test) 성능이 실제보다 부풀려져 평가가 잘못됨
- 단어 사전은 train에서만 만들고, 같은 사전으로 test도 변환만(transform) 해야 함

---

## @nlp-cn-oov-def
- type: func
- grade_mode: exact
- weight: 7
- answers: OOV | oov_token | Out-Of-Vocabulary | 미등록어

---FRONT---
어휘 사전(vocab)에 없는 단어를 만났을 때 버리지 않고 특수 토큰으로 대체해 문장 구조를 보존하는 기법은? (keras Tokenizer 파라미터명으로도 답 가능)
---BACK---
**OOV (Out-Of-Vocabulary) 처리 — `oov_token`**

- `Tokenizer(oov_token="<oov>")` 설정 시 미등록어를 `<oov>`로 대체
- 없으면 그 단어 위치가 통째로 사라져 문장 길이 변동·정보 손실 발생
- 비유: 모르는 단어가 나오면 "???로 표시" 하는 것

---

## @nlp-cn-padding-def
- type: judge
- grade_mode: exact
- weight: 8
- answers: 패딩 | padding | pad_sequences

---FRONT---
문장마다 단어 수가 달라 정수열 길이가 제각각인데, 신경망은 입력 크기가 일정해야 한다. 짧은 문장을 0으로 채워 모든 입력을 같은 길이로 맞추는 전처리 기법은?
---BACK---
**패딩(Padding)**

- keras: `pad_sequences(sequences, padding='post', maxlen=max_length)`
- `post`: 문장 뒤를 0으로 채움 / `pre`: 앞을 채움
- 길면 자르고(truncate), 짧으면 0으로 채움
- max_length를 너무 크게 하면 0이 과도해 계산 낭비, 너무 작으면 정보 손실
- 이유: 가중치 행렬 크기가 입력 차원에 고정 — 길이가 다르면 행렬 곱셈 불가

---

## @nlp-cn-padding-cloze
- type: cloze
- weight: 7

---FRONT---
패딩에서 `padding='post'`는 문장 {{뒤}}를 0으로 채우고, `padding='pre'`는 문장 {{앞}}을 0으로 채운다.
---BACK---
- `post(뒤 채움)`: 문장 내용 → 0000
- `pre(앞 채움)`: 0000 → 문장 내용
- RNN은 뒷부분 정보가 최종 상태에 더 영향을 주므로 pre를 선호하기도 함
- 어디를 채우느냐에 따라 모델이 "먼저 읽는 정보"가 달라짐

---

## @nlp-cn-embedding-def
- type: func
- grade_mode: exact
- weight: 9
- answers: 임베딩 | Embedding | 임베딩 층

---FRONT---
단어를 숫자(정수 인덱스)로 바꾼 뒤, 그 숫자를 의미를 담은 밀집 실수 벡터로 다시 변환하는 층으로, 원-핫 인코딩보다 저차원이며 비슷한 단어가 비슷한 벡터를 갖도록 학습되는 것은?
---BACK---
**임베딩(Embedding) 층**

- 학습 데이터의 분류(정답) 신호가 역전파되며 같은 클래스에 기여하는 단어들이 비슷한 벡터를 갖도록 조정됨(task-supervised 학습)
- 예: 서울·부산은 같은 클래스 문서에 함께 등장 시 비슷한 방향으로 수렴
- 비유: 단어를 지도 좌표로 표현 — 비슷한 단어는 가까운 좌표
- 원-핫: 어휘 10,000개 → 10,000차원 벡터 (거의 다 0)
- 임베딩: 64차원 밀집 벡터 → 훨씬 작고 의미 담음
- keras: `Embedding(input_dim=vocab_size, output_dim=embedding_dim)`

---

## @nlp-cn-embedding-vs-onehot
- type: judge
- grade_mode: exact
- weight: 7
- answers: 밀집 | dense | 저차원 | 의미

---FRONT---
원-핫 인코딩은 어휘 크기만큼 희소(sparse)한 벡터를 만든다. 임베딩은 이와 달리 어떤 특성의 벡터를 만드는가?
---BACK---
**밀집(dense)하고 저차원인 벡터**

- 원-핫: [0,0,0,...,1,...,0] → 거의 다 0 (희소)
- 임베딩: [0.21, -0.15, 0.83, ...] → 작은 차원에 의미가 응축 (밀집)
- 임베딩은 학습을 통해 비슷한 단어끼리 가까운 벡터를 갖도록 조정됨

---

## @nlp-cn-epoch-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 에폭 | epoch

---FRONT---
딥러닝 학습에서 전체 학습 데이터를 한 번 다 훑는 것을 1회라고 할 때, 이 "1회 전체 훑기"를 가리키는 용어는?
---BACK---
**에폭(Epoch)**

- 예: `epochs=100` → 전체 데이터를 100번 반복 학습
- 에폭이 너무 많으면 과적합 위험 / 너무 적으면 학습 부족
- EarlyStopping으로 적절한 에폭에서 자동 중단 가능

---

## @nlp-cn-gradient-descent
- type: func
- grade_mode: exact
- weight: 8
- answers: 경사하강법 | gradient descent | 경사 하강법

---FRONT---
손실이 작아지는 방향을 찾아 가중치를 조금씩 이동시키는 학습 방법은?
---BACK---
**경사하강법(Gradient Descent)**

- 경사(기울기)=손실이 어느 방향으로 얼마나 가파른지
- 반대 방향으로 이동하면 손실 감소. 이 반복이 학습의 핵심
- 비유: 안개 낀 산에서 발밑 경사를 더듬어 내려감(산 높이=손실값, 내려가는 것=손실 줄이는 방향으로 가중치 이동)

---

## @nlp-cn-batch-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 배치 | batch | 배치 크기 | batch_size

---FRONT---
딥러닝 학습에서 전체 데이터를 한 번에 다 쓰는 대신, 몇 개씩 묶어 가중치를 업데이트하는 단위를 무엇이라 하는가?
---BACK---
**배치(Batch)**

- `batch_size=64` → 64개 샘플씩 묶어 한 번 가중치 업데이트
- 1 스텝=한 배치를 보고 가중치를 손실이 작아지는 방향으로 조금 이동(경사하강법)
- 크게 하면: 학습 안정, 메모리 많이 사용
- 작게 하면: 업데이트 잦음, 노이즈 많지만 일반화에 유리할 수도
- 1 에폭 = (전체 데이터 수 / 배치 크기) 번의 업데이트

---

## @nlp-cn-loss-def
- type: func
- grade_mode: exact
- weight: 8
- answers: 손실 | loss | 손실함수 | loss function

---FRONT---
모델의 예측이 정답과 얼마나 틀렸는지를 숫자로 나타내는 것으로, 이 값이 작아질수록 모델이 학습되었다고 볼 수 있는 것은?
---BACK---
**손실(Loss)**

- 학습의 목표 = 손실을 최대한 줄이는 것
- 예측이 정답과 많이 다르면 손실 큼, 거의 같으면 손실 작음
- 학습 중 손실 그래프가 내려가면 잘 학습 중
- 검증 손실(val_loss)이 다시 올라가면 과적합 신호

---

## @nlp-cn-optimizer-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 옵티마이저 | optimizer | 최적화 알고리즘

---FRONT---
딥러닝에서 손실을 줄이는 방향으로 가중치를 업데이트하는 알고리즘을 무엇이라 하는가? 가장 많이 쓰이는 것으로 adam이 있다.
---BACK---
**옵티마이저(Optimizer)**

- 손실이 가장 작아지는 방향으로 가중치를 조금씩 조정하는 역할
- adam: 학습률을 자동 조정 → 튜닝 없이도 잘 작동하는 기본값
- 비유: 눈을 감고 산을 내려갈 때 발밑을 더듬어 내리막을 찾아가는 것
- keras: `model.compile(optimizer='adam', ...)`

---

## @nlp-cn-crossentropy-def
- type: judge
- grade_mode: exact
- weight: 8
- answers: categorical_crossentropy

---FRONT---
다중분류에서 정답이 원-핫 인코딩 형태일 때 사용하는 손실 함수는? (정답이 정수 라벨이면 `sparse_categorical_crossentropy`를 쓴다)
---BACK---
**categorical_crossentropy**

- 원-핫 정답 → `categorical_crossentropy`
- 정수 라벨 정답 → `sparse_categorical_crossentropy`
- 다중분류 손실: 예측 확률 분포와 정답 분포의 차이를 측정
- keras compile: `model.compile(loss='categorical_crossentropy', ...)`

---

## @nlp-cn-dropout-def
- type: func
- grade_mode: exact
- weight: 9
- answers: 드롭아웃 | Dropout | dropout

---FRONT---
학습 중 무작위로 일부 뉴런을 비활성화해 특정 뉴런에 과도하게 의존하는 것을 막아 과적합을 줄이는 규제 기법은?
---BACK---
**드롭아웃(Dropout)**

- keras: `Dropout(0.2)` → 학습 중 20% 뉴런을 무작위로 끔
- 추론(예측) 시에는 모든 뉴런 사용 (학습 시에만 적용)
- 비유: 팀원을 매번 무작위로 빼서 훈련 → 특정 사람에 의존 안 하게 됨
- 효과: 일반화 성능 향상

---

## @nlp-cn-batchnorm-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 배치 정규화 | BatchNormalization | 배치정규화

---FRONT---
층을 지나는 값들의 분포를 정규화해 학습을 안정시키고 수렴 속도를 높이는 딥러닝 기법은?
---BACK---
**배치 정규화(BatchNormalization)**

- (여기 정규화는 TF-IDF의 L2 정규화(벡터 크기 1로)와 다름 — 평균을 0, 분산을 1에 가깝게 맞춰 값을 고르게 하는 것)
- 미니배치 내 값들의 평균·분산을 정규화해 분포 안정화
- 학습이 흔들리는 것을 줄여 더 빠르고 안정적으로 수렴
- keras: `BatchNormalization()` — 레이어로 삽입
- 드롭아웃과 함께 과적합 억제·학습 안정화에 활용

---

## @nlp-cn-earlystop-def
- type: judge
- grade_mode: exact
- weight: 8
- answers: EarlyStopping | 조기 종료

---FRONT---
학습 중 검증 손실(val_loss)이 일정 에폭 동안 개선되지 않으면 학습을 자동으로 멈춰 과적합을 방지하고 불필요한 학습 시간을 줄이는 콜백은?
---BACK---
**EarlyStopping**

- keras: `EarlyStopping(monitor='val_loss', patience=5)`
- `patience=5`: 5에폭 동안 개선 없으면 중단 (일시적 변동에 바로 멈추지 않도록)
- `epochs=100`으로 크게 잡고 EarlyStopping이 적절한 시점에 자동 종료하는 패턴이 일반적
- 과적합 방지 + 학습 시간 절약 동시에 달성

---

## @nlp-cn-argmax-def
- type: cloze
- weight: 7

---FRONT---
softmax 출력은 클래스별 확률 배열이다. 가장 확률이 높은 클래스를 최종 예측으로 선택하려면 `np.{{argmax}}(y_pred, axis=1)`을 사용한다.
---BACK---
- `np.argmax(y_pred, axis=1)`: 행마다 가장 큰 값의 **인덱스(위치)** 반환
- softmax 확률 배열 → argmax → 클래스 인덱스 (정수)
- 예: [0.1, 0.7, 0.2] → argmax → 1 (가운데 클래스가 제일 확률 높음)
- 정답도 원-핫이면 동일하게 argmax로 클래스 인덱스로 변환 후 비교

---

## @nlp-cn-accuracy-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 정확도 | accuracy

---FRONT---
분류 모델 평가에서 가장 직관적인 지표로, 전체 예측 중 맞힌 비율을 나타내는 것은?
---BACK---
**정확도(Accuracy)**

- 공식: 맞힌 수 / 전체 수
- 예: 100개 중 67개 맞히면 정확도 = 0.67 (67%)
- 코드: `(y_test_val == y_predict).mean()`
- 한계: 클래스 불균형 데이터에서는 정확도만으로 판단이 어려움

---

## @nlp-cn-return-sequences
- type: judge
- grade_mode: exact
- weight: 7
- answers: return_sequences=True | True | return_sequences

---FRONT---
LSTM 층을 두 개 이상 쌓을 때, 첫 번째 LSTM이 마지막 시점의 출력만 내보내지 않고 모든 시점의 출력을 다음 LSTM에 넘기려면 어떤 파라미터를 어떻게 설정해야 하는가?
---BACK---
**`return_sequences=True`**

- `False`(기본): 마지막 시점 출력만 반환 → 마지막 LSTM에 사용
- `True`: 모든 시점의 출력(시퀀스 전체) 반환 → LSTM 적층 시 중간 층에 사용
- 첫 번째 LSTM에 True, 마지막 LSTM에는 기본값(False)

---

## @nlp-cn-vanishing-def
- type: func
- grade_mode: exact
- weight: 9
- answers: 기울기 소실 | vanishing gradient | 그래디언트 소실

---FRONT---
긴 문장에서 맨 앞 단어의 학습 신호가 뒤로 갈수록 점점 희미해져 0에 가까워지는 문제로, SimpleRNN에서 특히 심하게 나타나는 것은?
---BACK---
**기울기 소실(Vanishing Gradient)**

- 비유: 전화 게임 — 100명을 거치면 첫 메시지가 흐릿해짐
- 그래디언트(뒤에서 앞으로 전달되는 오차 신호)는 활성화함수의 기울기값인데 이 값이 0~1이면 층을 거듭 통과할수록 점점 작아짐
- 1보다 작은 수를 여러 번 곱하게 되어(연쇄 곱셈) 신호가 0에 수렴 → 앞쪽 단어는 가중치 업데이트에서 사실상 배제됨
- 긴 문장에서 앞쪽 단어의 영향이 뒤쪽까지 거의 전달되지 않음
- SimpleRNN의 치명적 약점
- 해결책: LSTM·GRU의 게이트 구조

---

## @nlp-cn-lstm-def
- type: func
- grade_mode: exact
- weight: 9
- answers: LSTM | Long Short-Term Memory

---FRONT---
SimpleRNN의 기울기 소실 문제를 개선하기 위해 게이트(입력·망각·출력)와 셀 상태를 추가해 장기 기억을 유지하는 순환 신경망은?
---BACK---
**LSTM (Long Short-Term Memory)**

- "긴(Long) 단기(Short-Term) 기억" = 오랜 기억도 유지 가능
- 게이트(gate)=0~1 값으로 정보를 얼마나 통과시킬지 조절하는 밸브(0=차단,1=통과)
- 세 가지 게이트: 망각(뭘 잊을지) / 입력(뭘 기억할지) / 출력(뭘 내보낼지)
- 셀 상태(cell state): 정보를 직접 전달하는 고속도로 역할
- SimpleRNN은 상태가 1종류(은닉 상태)라 정보가 덮어쓰여 손실됨. LSTM은 셀 상태를 별도 레일로 두어 게이트로 걸러진 정보만 더하거나 뺌 → 장기 기억 유지
- 긴 문장에서 앞쪽 문맥을 기억하며 분류

---

## @nlp-cn-gru-def
- type: func
- grade_mode: exact
- weight: 7
- answers: GRU | Gated Recurrent Unit

---FRONT---
LSTM의 게이트 구조를 간소화해 비슷한 장기 의존성 처리 능력을 더 적은 파라미터로 구현한 순환 신경망은?
---BACK---
**GRU (Gated Recurrent Unit)**

- LSTM의 3개 게이트 → 2개(업데이트·리셋)로 단순화
- 파라미터 수 감소 → 학습 속도 향상, 데이터가 적을 때 유리
- 성능: LSTM과 유사하나 경우에 따라 다름
- 비교: SimpleRNN(기울기 소실) → LSTM(게이트 보완) → GRU(경량화)

---

## @nlp-cn-bidirectional-def
- type: func
- grade_mode: exact
- weight: 7
- answers: Bidirectional | 양방향 | 양방향 LSTM | BiLSTM

---FRONT---
일반 RNN은 앞→뒤 한 방향으로만 읽지만, 앞뒤 두 방향으로 모두 읽어 한 단어를 양쪽 문맥으로 이해할 수 있게 감싸는 래퍼 층은?
---BACK---
**Bidirectional (양방향)**

- 앞→뒤(순방향) + 뒤→앞(역방향) LSTM을 함께 실행
- 예: "나는 은행에 갔다" → "은행"이 강가인지 금융인지 뒤를 봐야 알 수 있음
- keras: `Bidirectional(LSTM(units=64))`
- 문장 전체 맥락이 중요한 분류 작업에 유리

---

## @nlp-cn-overfit-diagnose
- type: judge
- grade_mode: exact
- weight: 9
- answers: 과적합 | overfitting | 오버피팅

---FRONT---
7.2 RNN 모델에서 학습 정확도는 약 0.96인데 검증·테스트 정확도는 약 0.67로 큰 차이가 났다. 이 현상을 무엇이라 하는가?
---BACK---
**과적합(Overfitting)**

- 학습 데이터는 잘 맞히지만 새 데이터(검증·테스트)에서 성능이 크게 떨어짐
- 진단 기준: train 성능 ≫ val/test 성능 (격차가 클수록 심함)
- 개선: 드롭아웃 강화, 배치정규화, EarlyStopping, 데이터 증강, 모델 단순화

---

## @nlp-cn-generalization-def
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
과적합과 일반화의 관계 및 일반화를 높이는 대표 기법을 설명하라.
---BACK---
**일반화(Generalization)**

- 학습 데이터를 외우는 것이 아니라 패턴을 학습하는 것
- 과적합 = 일반화 실패 (train 성능 >> validation 성능)
- 개선 방법: 드롭아웃, 배치정규화, EarlyStopping, 데이터 증강, 모델 단순화

---

## @nlp-cn-overfit-remedies
- type: cloze
- weight: 8

---FRONT---
과적합을 줄이는 3가지 대표 기법: 학습 중 뉴런을 무작위로 끄는 {{드롭아웃}}, 값 분포를 정규화해 학습을 안정시키는 {{배치정규화}}, 검증 손실이 더 이상 좋아지지 않으면 학습을 멈추는 {{EarlyStopping}}.
---BACK---
- **드롭아웃**: 무작위 뉴런 비활성화 → 특정 경로 의존 방지
- **배치정규화**: 층 간 값 분포 안정화 → 학습 안정
- **EarlyStopping**: 검증 손실 모니터링 → 과도한 학습 자동 중단
- 셋 다 "과적합 = 외운다"를 막는 서로 다른 접근법

---

## @nlp-cn-feature-def
- type: func
- grade_mode: exact
- weight: 7
- answers: 특징 | feature | 피처

---FRONT---
머신러닝에서 모델에 입력되는 각 열(변수)을 무엇이라 하는가? 텍스트 분석에서는 각 단어가 이것에 해당한다.
---BACK---
**특징(Feature, 피처)**

- 예: 문서-단어행렬에서 열 하나 = "민원"이라는 특징
- 각 문서는 수천 개의 특징(단어) 값으로 표현됨
- `get_feature_names_out()` = 어떤 특징(단어)이 몇 번째 열인지 확인

---
