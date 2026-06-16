# 1) 개념 — 텍스트를 숫자로, 그리고 의미를 배우기

---

## 1. 왜 텍스트를 숫자로 바꿔야 하나

컴퓨터는 글자 자체를 "이해"하지 못합니다. 컴퓨터가 할 수 있는 건 덧셈·곱셈처럼 숫자 계산뿐이에요. 그래서 "서울 민원"이라는 문장도 결국 숫자로 바꿔야만 모델에 넣을 수 있습니다.

<figure class="nlp-fig"><img src="https://raw.githubusercontent.com/mrdbourke/tensorflow-deep-learning/main/images/08-tokenization-vs-embedding.png" alt="토큰화 vs 임베딩 대조" loading="lazy"><figcaption>이 그림은 텍스트가 숫자로 바뀌는 전체 흐름을 보여줘요. 왼쪽의 "토큰화 → 정수 인코딩" 단계는 단어를 번호로 바꾸는 과정이고, 오른쪽의 "임베딩" 단계는 그 번호를 의미가 담긴 숫자 묶음으로 바꾸는 과정이에요. 두 단계가 이어져서 최종적으로 모델이 처리할 수 있는 형태가 만들어집니다. (mrdbourke/tensorflow-deep-learning, MIT)</figcaption></figure>

<div class="cbox cbox-def">💡 <b>기본 용어 한눈에</b><br><br><b>토큰(token)</b> — 텍스트를 쪼갠 가장 작은 단위예요. 보통 단어 하나가 토큰 하나입니다. 예: "나는 학교에 간다" → ["나는", "학교에", "간다"]<br><br><b>말뭉치(corpus, 코퍼스)</b> — 분석에 쓸 텍스트 전체 묶음이에요. 예: 민원 데이터 5,000건 전부. 도서관에 있는 책을 모두 모아놓은 것과 비슷해요.<br><br><b>어휘(vocabulary, 보캐뷸러리)</b> — 말뭉치에 나온 단어들을 중복 없이 모은 목록이에요. 단어 사전이라고 생각하면 됩니다.<br><br><b>벡터(vector, 벡터)</b> — 숫자를 일렬로 늘어놓은 것이에요. 예: [0, 3, 0, 1, 0, …]. 컴퓨터가 처리하는 "숫자 꼬치"라고 생각하세요.<br><br><b>행렬(matrix, 매트릭스)</b> — 벡터를 여러 개 위아래로 쌓아 놓은 것이에요. 예: 문서 1,000편 × 단어 500개 = 1,000×500 행렬. 엑셀 표와 비슷한 모양이에요.<br><br><b>차원(dimension, 디멘션)</b> — 벡터 안에 숫자가 몇 개인지를 말해요. 단어 500개짜리 사전 → 차원 500. 숫자 칸이 500개라는 뜻이에요.</div>

텍스트를 숫자로 바꾸는 방법은 크게 세 갈래가 있어요. **단어 빈도 기반(BOW, TF-IDF)**, **토픽 모델링(LDA)**, 그리고 **딥러닝 기반 임베딩**입니다. 하나씩 살펴보겠습니다.

<a class="explore" href="https://tiktokenizer.vercel.app/" target="_blank" rel="noopener">🔗 Tiktokenizer — 토큰화 실시간 시각화</a>

---

## 2. BOW — 단어 가방

BOW는 "Bag-of-Words(백 오브 워즈)"의 줄임말입니다. 직역하면 **단어 가방**이에요.

가방에 단어 쪽지를 마구 집어넣는 장면을 떠올려 보세요. 쪽지의 순서는 상관없이, 어떤 단어가 몇 장 들어있는지만 셉니다. BOW도 마찬가지예요. 문장에서 **단어의 순서는 완전히 무시하고, 어떤 단어가 몇 번 나왔는지만 봅니다.**

<div class="cbox cbox-def">💡 <b>정의</b> — BOW(Bag-of-Words, 단어 가방): 단어가 몇 번 나왔는지만 세서 문서를 표현하는 방식이에요.<br><br>예: "나는 학교에 가고 학교에서 공부한다"<br>→ {'나는':1, '학교에':1, '가고':1, '학교에서':1, '공부한다':1}<br><br>쉽게 말하면, 단어별로 출석을 체크하는 것과 같아요.</div>

### 문서-단어 행렬(DTM)

여러 문서를 한꺼번에 BOW로 정리하면 표처럼 생긴 숫자 묶음이 만들어집니다. 이걸 **DTM(Document-Term Matrix, 디티엠 — 문서-단어 행렬)**이라고 해요. 가로줄(행)은 각 문서, 세로줄(열)은 단어, 칸 안의 숫자는 그 단어가 몇 번 나왔는지입니다.

```python
from sklearn.feature_extraction.text import CountVectorizer

cv = CountVectorizer()
dtm = cv.fit_transform(문서_목록)
```

`fit_transform`은 두 단계를 한 번에 해줘요. 먼저 `fit`에서 단어 사전을 만들고, `transform`에서 각 문서를 숫자 배열로 바꿉니다.

<div class="cbox cbox-warn">⚠️ <b>희소 행렬 주의</b> — 단어 사전엔 수만 개 단어가 있지만, 문서 하나에 실제로 쓰인 단어는 극히 일부예요. 나머지 칸은 전부 0이 됩니다. 이렇게 0이 대부분인 행렬을 <b>희소 행렬(sparse matrix, 스파스 매트릭스)</b>이라고 해요. 대부분이 빈칸(0)인 엄청 큰 표를 상상하면 됩니다. <code>toarray()</code>로 보면 메모리가 폭발할 수 있으니 확인용으로만 씁니다.</div>

### BOW의 한계

<div class="cbox cbox-warn">⚠️ <b>한계</b> — BOW는 순서를 완전히 무시합니다. "나는 너를 좋아해"와 "너는 나를 좋아해"는 단어 구성이 같아서 BOW에서는 완전히 동일하게 표현돼요. 문맥도, 의미도 담지 못합니다. 그래서 더 정교한 방법이 필요합니다.</div>

---

## 3. N-gram과 불용어

### N-gram

BOW는 단어를 하나씩 따로 봅니다. 이렇게 단어 하나씩 보는 방식을 **유니그램(1-gram)**이라고 해요. 하지만 "서울 시청"은 두 단어를 붙여서 봐야 의미가 살아나죠.

**N-gram(엔그램)**은 연속된 N개 단어를 하나의 단위로 묶어서 보는 방법이에요. N이 1이면 단어 하나씩, 2면 두 단어씩 묶어서 처리합니다.

| 종류 | 예시 |
|------|------|
| 유니그램(1-gram) | "서울", "시청", "방문" |
| 바이그램(2-gram) | "서울 시청", "시청 방문" |
| 트라이그램(3-gram) | "서울 시청 방문" |

`ngram_range=(1, 2)`로 설정하면 단어 하나짜리와 두 단어짜리를 함께 씁니다. "서울 시청"처럼 붙어야 의미가 사는 표현을 잡을 수 있어서 유용해요. 단, N을 키울수록 경우의 수가 폭발적으로 늘어 계산이 무거워집니다. 보통 `(1,2)` 정도가 안전한 선택이에요.

### 불용어

<div class="cbox cbox-def">💡 <b>불용어(stop words, 스톱워즈)</b> — "있습니다", "하는", "경우", "또는"처럼 거의 모든 문서에 공통으로 나오는 단어를 말해요. 너무 흔해서 문서 주제를 구분하는 데 도움이 안 됩니다. 쉽게 말하면, 모든 책에 나오는 "그리고"나 "하지만" 같은 단어예요. 이런 단어를 제거하면 분석 품질이 올라갑니다.</div>

```python
cv = CountVectorizer(stop_words=["경우", "또는", "있습니다"])
```

---

## 4. TF, IDF, TF-IDF

### TF — 단어 빈도

**TF(Term Frequency, 티에프 — 단어 빈도)**는 어떤 단어가 하나의 문서 안에서 얼마나 자주 나왔는지를 나타내는 숫자예요. 많이 나올수록 TF가 높습니다.

그런데 TF만 보면 문제가 생겨요. "있습니다"처럼 모든 문서에서 흔하게 쓰이는 단어가 TF도 높게 나와, 실제로는 중요하지 않은 단어가 과대평가됩니다.

### IDF — 역문서 빈도

<div class="cbox cbox-def">💡 <b>IDF(Inverse Document Frequency, 아이디에프 — 역문서 빈도)</b> — "이 단어가 얼마나 희귀한가?"를 점수로 나타낸 값이에요. "역(Inverse)"이라는 말은 "반대로"라는 뜻으로, 문서에 많이 나올수록 점수를 낮추는 방식을 말해요.<br><br>생각해보면, 모든 문서에 나오는 단어는 별로 특별하지 않죠. 반대로 딱 몇 개 문서에만 나오는 단어는 그 문서의 특징을 잘 보여줘요.<br><br>IDF를 말로 설명하면: log( 전체 문서 수 ÷ 그 단어가 나온 문서 수 )<br>흔한 단어 → IDF 낮음 / 희귀한 단어 → IDF 높음.<br><br>여기서 log(로그)는 값이 너무 커지지 않도록 눌러주는 역할이에요. 예를 들어 문서가 10,000건이고 단어가 1건에만 나오면 그냥 나누면 10,000이 되는데, log를 쓰면 4 정도로 줄어들어요.</div>

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Plot_IDF_functions.png/500px-Plot_IDF_functions.png" alt="IDF 함수 곡선" loading="lazy"><figcaption>이 그림은 IDF 값이 어떻게 달라지는지를 보여줘요. 핵심은 가로축(그 단어가 등장하는 문서의 수)이 늘어날수록 IDF 값(세로축)이 낮아진다는 것입니다. 즉, 많은 문서에 공통으로 나오는 흔한 단어일수록 점수가 낮아지는 거예요. (Wikimedia Commons)</figcaption></figure>

`smooth_idf=True`(기본값)는 분모에 1을 더해서 0으로 나누는 오류를 방지하는 작은 안전장치예요.

### TF-IDF — 둘을 곱하는 이유

$$\text{TF-IDF}(\text{단어}, \text{문서}) = \text{TF} \times \text{IDF}$$

직관으로 먼저 이해해 봅시다. "이 문서에서 자주 나오면서(TF 높음), 다른 문서에는 잘 안 나온다면(IDF 높음)" — 그 단어는 이 문서에서만 특별히 중요한 단어입니다. 두 점수를 곱하면 그런 단어가 높은 점수를 받아요.

쉽게 말하면: **TF-IDF(티에프 아이디에프)는 "이 문서에서만 진짜 중요한 단어"에 높은 점수를 주는 방법**이에요.

<figure class="nlp-fig"><img src="https://www.tidytextmining.com/03-tf-idf_files/figure-html/plotseparate-1.png" alt="문서별 상위 TF-IDF 단어 바차트" loading="lazy"><figcaption>이 그림은 여러 문서에서 TF-IDF 점수가 높은 단어들을 막대 그래프로 보여줘요. 핵심은 문서마다 서로 다른 단어가 높이 나온다는 것입니다. 공통적으로 흔한 단어는 걸러지고, 각 문서에서만 특별히 많이 쓰이는 단어들이 선택돼요. 즉, 각 문서의 주제를 잘 잡아준다는 뜻이에요. (tidytextmining.com, CC BY-NC-SA)</figcaption></figure>

```python
from sklearn.feature_extraction.text import TfidfVectorizer

tfidf = TfidfVectorizer(stop_words=[...])
dtm_tfidf = tfidf.fit_transform(df["문서"])
```

<div class="cbox cbox-key">🔑 <b>핵심</b> — <code>sublinear_tf=True</code>를 설정하면 TF에 로그를 적용(1+log(TF))해요. 한 단어가 아주 많이 나왔을 때 점수가 무한정 커지는 걸 막아줍니다. 쉽게 말하면, 100번 나온 단어가 10번 나온 단어보다 꼭 10배 중요하진 않으니까, 점수를 좀 눌러주는 거예요.</div>

<a class="explore" href="https://remykarem.github.io/tfidf-demo/" target="_blank" rel="noopener">🔗 TF-IDF 4문서 실시간 계산기</a>
<a class="explore" href="https://melaniewalsh.github.io/Intro-Cultural-Analytics/05-Text-Analysis/03-TF-IDF-Scikit-Learn.html" target="_blank" rel="noopener">🔗 TF-IDF 히트맵 교재</a>

---

## 5. 코사인 유사도

### 방향 vs 거리

두 문서가 얼마나 비슷한지 수치로 나타내려면 어떻게 할까요?

가장 먼저 떠오르는 방법은 "벡터 사이의 거리"입니다. **유클리드 거리(Euclidean distance, 유클리디안 디스턴스)**는 두 점 사이의 직선 거리예요. 우리가 지도에서 두 장소의 거리를 자로 재는 것과 같아요. 그런데 이 방법은 문서 길이 차이에 너무 민감해요. 문서 A가 1,000단어, 문서 B가 100단어라면 같은 주제라도 "거리가 멀다"고 나올 수 있거든요.

**코사인 유사도(cosine similarity, 코사인 시밀래리티)**는 다른 방법을 씁니다. 두 벡터가 이루는 **각도(방향)**만 비교해요. 길이가 달라도 방향이 같으면 유사하다고 봅니다.

비유를 들면, 두 사람이 "서울역"을 가리키고 있다면, 한 사람의 팔이 더 길든 짧든 상관없이 둘은 같은 방향을 가리키는 거예요. 코사인 유사도는 그 방향의 일치 정도를 봅니다.

<figure class="nlp-fig"><img src="https://storage.googleapis.com/lds-media/images/cosine-similarity-vectors.original.jpg" alt="θ=0/90/180 세 케이스" loading="lazy"><figcaption>이 그림은 두 벡터 사이 각도(θ, 세타)에 따른 코사인 유사도를 보여줘요. 핵심은 세 가지 경우입니다. θ=0(같은 방향)이면 cos 값이 1로 "완전히 유사", θ=90°이면 0으로 "전혀 관계 없음", θ=180°이면 -1로 "완전히 반대 방향"이에요. 텍스트 분석에서는 보통 0~1 사이 값이 나옵니다. (LearnDataSci)</figcaption></figure>

<figure class="nlp-fig"><svg viewBox="0 0 560 260" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="13">
  <!-- 배경 분할 -->
  <rect x="0" y="0" width="280" height="260" fill="#f0f4f8" rx="10"/>
  <rect x="280" y="0" width="280" height="260" fill="#f4f0f8" rx="10"/>

  <!-- 왼쪽 패널 제목 -->
  <text x="140" y="24" text-anchor="middle" font-size="14" font-weight="bold" fill="#3a5a8c">코사인 유사도 (방향)</text>

  <!-- 왼쪽 좌표 원점 -->
  <circle cx="80" cy="190" r="3" fill="#555"/>
  <text x="74" y="205" font-size="11" fill="#555">O</text>

  <!-- 벡터 A (파랑) -->
  <line x1="80" y1="190" x2="190" y2="90" stroke="#4a7cc9" stroke-width="2.5" marker-end="url(#arr-blue)"/>
  <text x="198" y="86" fill="#4a7cc9" font-weight="bold">A</text>

  <!-- 벡터 B (진한 파랑, 같은 방향 다른 길이) -->
  <line x1="80" y1="190" x2="145" y2="127" stroke="#8b5cf6" stroke-width="2.5" marker-end="url(#arr-purple)"/>
  <text x="150" y="120" fill="#8b5cf6" font-weight="bold">B</text>

  <!-- 각도 호 -->
  <path d="M 107 166 A 30 30 0 0 1 113 171" stroke="#e05" stroke-width="1.5" fill="none"/>
  <text x="118" y="172" font-size="11" fill="#e05">θ≈15°</text>

  <!-- cos 결과 -->
  <text x="140" y="232" text-anchor="middle" font-size="12" fill="#3a5a8c">cos(15°) ≈ <tspan font-weight="bold">0.97</tspan> → 매우 유사</text>
  <text x="140" y="250" text-anchor="middle" font-size="11" fill="#888">크기 달라도 방향 비슷 → 유사</text>

  <!-- 오른쪽 패널 제목 -->
  <text x="420" y="24" text-anchor="middle" font-size="14" font-weight="bold" fill="#6b3a8c">유클리드 거리 (크기)</text>

  <!-- 오른쪽 좌표 원점 -->
  <circle cx="310" cy="190" r="3" fill="#555"/>
  <text x="304" y="205" font-size="11" fill="#555">O</text>

  <!-- 점 A' -->
  <circle cx="420" cy="90" r="5" fill="#4a7cc9"/>
  <text x="428" y="88" fill="#4a7cc9" font-weight="bold">A</text>

  <!-- 점 B' (비슷한 방향이지만 다른 위치) -->
  <circle cx="380" cy="135" r="5" fill="#8b5cf6"/>
  <text x="388" y="133" fill="#8b5cf6" font-weight="bold">B</text>

  <!-- 유클리드 거리선 -->
  <line x1="420" y1="90" x2="380" y2="135" stroke="#e05" stroke-width="2" stroke-dasharray="5,3"/>
  <text x="408" y="107" font-size="11" fill="#e05">d</text>

  <!-- A, B를 원점에 연결 (점선) -->
  <line x1="310" y1="190" x2="420" y2="90" stroke="#4a7cc9" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>
  <line x1="310" y1="190" x2="380" y2="135" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>

  <!-- 결과 -->
  <text x="420" y="232" text-anchor="middle" font-size="12" fill="#6b3a8c">d = <tspan font-weight="bold">57px</tspan> → 멀다고 판단</text>
  <text x="420" y="250" text-anchor="middle" font-size="11" fill="#888">방향 비슷해도 크기 차이 → 거리 큼</text>

  <!-- 화살표 마커 -->
  <defs>
    <marker id="arr-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#4a7cc9"/>
    </marker>
    <marker id="arr-purple" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#8b5cf6"/>
    </marker>
  </defs>
</svg><figcaption>이 그림은 코사인 유사도(왼쪽)와 유클리드 거리(오른쪽)가 어떻게 다른지를 보여줘요. 핵심은 왼쪽에서 A와 B는 길이가 달라도 방향이 비슷해서 유사도가 높게 나오지만(0.97), 오른쪽에서는 두 점 사이 직선 거리 d가 커서 "멀다"고 판단한다는 점입니다. 짧은 문서와 긴 문서가 같은 주제를 다뤄도 유클리드 거리는 멀게 나오지만 코사인 유사도는 높게 나와요.</figcaption></figure>

<div class="cbox cbox-key">🔑 <b>핵심</b> — 코사인 유사도 값이 1에 가까울수록 두 문서가 비슷하고, 0에 가까울수록 관계가 없어요. 자기 자신과 비교하면 항상 1입니다.</div>

```python
from sklearn.metrics.pairwise import cosine_similarity

similarity = cosine_similarity(dtm_tfidf[0], dtm_tfidf)
```

<a class="explore" href="https://dejan.ai/tools/cosine/" target="_blank" rel="noopener">🔗 벡터 드래그 코사인 유사도 인터랙티브</a>

---

## 6. LDA 토픽 모델링

민원 5,000건에는 "도로 공사", "주차 문제", "쓰레기 수거" 같은 주제가 섞여 있어요. 사람이 직접 5,000건을 읽고 분류하기엔 너무 많습니다. 자동으로 주제를 찾아주는 방법이 없을까요?

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/d/d3/Latent_Dirichlet_allocation.svg" alt="LDA 플레이트 표기" loading="lazy"><figcaption>이 그림은 LDA의 수학적 구조를 다이어그램으로 나타낸 것이에요. 처음 보면 복잡해 보이지만, 핵심 구조만 보면 됩니다. 바깥 큰 상자는 M개의 문서를 나타내고, 안쪽 상자는 각 문서가 K개의 주제(토픽)를 섞어서 담고 있다는 뜻이에요. 각 주제는 특정 단어들을 자주 쓰는 "단어 묶음"이에요. 수식 기호(α, β 등)는 확률 분포를 조절하는 설정값인데, 처음에는 "주제의 혼합 비율을 조절하는 숫자"로만 이해하면 충분해요. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<div class="cbox cbox-def">💡 <b>LDA(Latent Dirichlet Allocation, 엘디에이 — 잠재 디리클레 할당)</b> — 글자 그대로는 어렵지만, 쉽게 말하면 "문서에서 숨겨진 주제를 자동으로 찾아주는 방법"이에요. "잠재(Latent)"는 눈에 안 보이는 숨겨진 주제라는 뜻이에요.<br><br><b>가정 ①</b> 문서는 여러 토픽의 혼합이에요. "도로 70% + 소음 30%"처럼, 한 문서가 여러 주제를 담을 수 있습니다.<br><br><b>가정 ②</b> 각 토픽은 특정 단어들을 많이 씁니다. "교통" 토픽이라면 "도로", "차량", "주차" 같은 단어가 많이 나오는 식이에요.</div>

LDA는 정답(라벨)을 전혀 사용하지 않아요. 오직 단어가 자주 함께 나타나는 패턴만으로 주제를 찾아냅니다. 이렇게 정답 없이 패턴을 스스로 찾는 방법을 **비지도 학습(unsupervised learning)**이라고 해요. 7절에서 더 자세히 설명합니다.

<div class="cbox cbox-warn">⚠️ <b>왜 Count 행렬을 쓰나</b> — LDA는 "이 단어가 몇 번 나왔는가"라는 정수 빈도를 기반으로 확률을 계산해요. TF-IDF는 가중치가 곱해진 소수점 숫자라 LDA의 계산 방식과 맞지 않습니다. 그래서 LDA에는 <code>CountVectorizer</code>로 만든 행렬을 넣어야 해요. 문서 유사도 계산에는 TF-IDF가 더 낫고요. 용도에 따라 나눠 쓰세요.</div>

```python
from sklearn.decomposition import LatentDirichletAllocation

lda = LatentDirichletAllocation(n_components=10, random_state=42)
lda.fit(dtm_cv)
```

`n_components`는 몇 개의 토픽(주제)을 찾을지 정하는 숫자예요. 너무 적으면 주제들이 뭉개지고, 너무 많으면 비슷한 주제가 잘게 쪼개져 해석하기 어렵습니다. `random_state=42`는 결과가 매번 다르게 나오지 않도록 초기값을 고정하는 장치예요.

<a class="explore" href="https://nbviewer.org/github/bmabey/pyLDAvis/blob/master/notebooks/pyLDAvis_overview.ipynb" target="_blank" rel="noopener">🔗 pyLDAvis 인터-토픽 거리맵 노트북</a>

---

## 7. 지도 학습 vs 비지도 학습, 분류 기초

<div class="cbox cbox-def">💡 <b>지도 학습(supervised learning, 수퍼바이즈드 러닝)</b> — 정답이 있는 상태에서 학습해요. 문제(입력)와 답(라벨)을 함께 주면서 "이 민원은 행정 민원", "저 민원은 복지 민원"을 가르쳐주는 방식입니다. 선생님이 옆에서 정답을 알려주는 것과 같아요.<br><br><b>비지도 학습(unsupervised learning, 언수퍼바이즈드 러닝)</b> — 정답 없이 데이터의 패턴을 스스로 찾아요. LDA가 여기 해당해요. 누가 "이게 교통 민원이야"라고 알려주지 않아도 스스로 주제를 발견합니다.</div>

### 원-핫 인코딩

분류 모델에서 정답 라벨을 숫자로 표현할 때 주의할 점이 있어요. "행정=0, 경제=1, 복지=2"처럼 단순히 번호를 붙이면, 모델이 0 < 1 < 2라는 순서나 크기 관계가 있다고 오해할 수 있어요. 행정과 경제 사이에 크기 관계 같은 건 없는데 말이죠.

이 문제를 해결하는 방법이 **원-핫 인코딩(one-hot encoding, 원 핫 인코딩)**이에요. "원-핫"은 "하나만 켜진"이라는 뜻이에요. 각 클래스마다 "자기 자리"에만 1을 넣고 나머지는 0으로 채우는 방식입니다.

| 클래스 | 행정 | 경제 | 복지 |
|--------|------|------|------|
| 행정   | 1    | 0    | 0    |
| 경제   | 0    | 1    | 0    |
| 복지   | 0    | 0    | 1    |

각 클래스는 딱 하나의 자리에만 1이 들어가고 나머지는 0이에요. 서로 대등한 관계임을 숫자로 표현하는 거죠. 딥러닝에서 출력층이 softmax(9절에서 설명)를 쓸 때 이 형태의 정답과 짝이 맞습니다.

---

## 8. train/test 분리 — 일반화와 과적합

모델이 학습한 데이터를 그대로 평가에도 쓰면 어떻게 될까요? 시험 답을 미리 알려주고 시험을 보는 것과 같아요. 점수는 높게 나오지만, 실제 실력을 알 수 없게 됩니다.

그래서 데이터를 **훈련용(train)**과 **테스트용(test)**으로 나눠요. 모델은 train만 보고 배우고, test는 처음 보는 데이터처럼 평가에만 씁니다. test에서도 잘 맞추면, 모델이 특정 데이터를 외운 게 아니라 진짜 패턴을 배웠다는 뜻이에요. 이렇게 새 데이터에도 잘 동작하는 능력을 **일반화(generalization, 제너럴라이제이션)**라고 합니다.

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/f/f1/Overfitting_Example_with_Generalization.png" alt="과적합 vs 일반화 비교" loading="lazy"><figcaption>이 그림은 모델이 너무 복잡할 때(과적합)와 적당할 때(일반화)를 비교해 보여줘요. 핵심은 점선(구불구불한 고차 곡선)이 훈련 데이터의 점들을 거의 완벽하게 통과하지만, 그 사이사이의 잡음까지 외워버려서 새 데이터엔 형편없이 맞지 않는다는 것입니다. 반면 실선(완만한 곡선)은 전체적인 패턴만 잡아 새 데이터에도 잘 들어맞아요. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<div class="cbox cbox-def">💡 <b>과적합(overfitting, 오버피팅)</b> — train 정확도는 높은데 test 정확도는 크게 떨어지는 현상이에요. 모델이 학습 데이터를 통째로 외워버려서 새 데이터엔 제대로 대응 못 하는 상태예요. 시험 문제를 달달 외웠는데 약간 다르게 나온 문제는 못 푸는 것과 같아요.<br><br><b>과소적합(underfitting, 언더피팅)</b> — train에서도 성능이 낮은 경우예요. 모델이 너무 단순하거나 충분히 학습하지 못한 상태입니다. 공부를 아예 안 하고 시험 보는 것과 같아요.</div>

```python
from sklearn.model_selection import train_test_split

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y)
```

<div class="cbox cbox-key">🔑 <b>stratify=y</b> — 데이터를 나눌 때 각 클래스의 비율이 원래와 같게 유지되도록 합니다. 예를 들어 원본 데이터가 행정 60% / 경제 30% / 복지 10%라면, train과 test에서도 그 비율이 그대로 유지돼요. 클래스 수가 불균형할수록 이게 중요합니다.</div>

<div class="cbox cbox-warn">⚠️ <b>fit은 train에만, transform은 둘 다</b> — CountVectorizer 같은 도구의 <code>fit</code>을 test 데이터에 쓰면 안 돼요. 시험 데이터를 미리 엿보는 것(데이터 누수, data leakage)이 됩니다. 데이터 누수란 모델이 테스트 정보를 학습 단계에서 이미 알아버리는 상황을 말해요. 올바른 순서: train으로만 <code>fit</code>해서 단어 사전을 만들고, 그 사전으로 train과 test 모두를 <code>transform</code>합니다.</div>

<a class="explore" href="https://mlu-explain.github.io/bias-variance/" target="_blank" rel="noopener">🔗 편향-분산 인터랙티브</a>
<a class="explore" href="https://playground.tensorflow.org/" target="_blank" rel="noopener">🔗 TensorFlow Playground — 정규화 조절로 과적합 체험</a>

---

## 9. 딥러닝의 토대 — 신경망

### 뉴런, 층, 가중치

우리 뇌는 수백억 개의 뉴런(신경세포)이 연결되어 정보를 처리해요. 딥러닝의 신경망은 이걸 흉내 낸 거예요. 수학적으로 단순화한 뉴런들을 여러 층으로 쌓아 복잡한 패턴을 학습합니다.

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/3/31/Perceptron.svg" alt="퍼셉트론 뉴런 구조" loading="lazy"><figcaption>이 그림은 가장 기본적인 뉴런(퍼셉트론) 하나의 구조를 보여줘요. 핵심은 왼쪽에서 여러 입력값(x1, x2, x3…)이 들어오면 각각 가중치(w, 중요도 숫자)를 곱해서 모두 더하고, 그 결과를 활성화 함수에 통과시켜 최종 출력을 만드는 흐름입니다. 가중치가 클수록 그 입력이 출력에 더 큰 영향을 미쳐요. (Wikimedia Commons, CC BY-SA 3.0)</figcaption></figure>

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/4/46/Multilayer_Perceptron_with_one_hidden_layer.svg" alt="MLP 입력·은닉·출력층" loading="lazy"><figcaption>이 그림은 여러 뉴런을 층으로 쌓은 신경망(MLP — 다층 퍼셉트론, Multi-Layer Perceptron)의 구조를 보여줘요. 핵심은 왼쪽 입력층(데이터가 들어오는 곳) → 가운데 은닉층(숨겨진 층, 실제 계산이 일어나는 곳) → 오른쪽 출력층(최종 결과가 나오는 곳)으로 정보가 흘러가는 구조입니다. 은닉층이 여러 개일수록 "딥(deep)"러닝이에요. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<div class="cbox cbox-def">💡 <b>학습이란?</b> = 가중치(각 연결선의 중요도 숫자)를 조정해가는 과정이에요.<br><br>① 모델이 예측을 내놓으면<br>② 정답과 얼마나 다른지(이걸 <b>손실(loss)</b>이라고 해요)를 계산하고<br>③ 손실을 줄이는 방향으로 가중치를 조금씩 수정합니다.<br>④ 이걸 수천~수만 번 반복하면 점점 잘 맞추게 돼요.<br><br>이 과정에서 "오차 신호를 뒤에서 앞으로 전달해서 각 가중치를 수정하는 알고리즘"을 <b>역전파(backpropagation, 백프로파게이션)</b>라고 해요. 정답을 보고 거꾸로 돌아가며 "어디서 틀렸는지" 책임을 나눠주는 방식이에요.</div>

### 활성화 함수

**활성화 함수(activation function, 액티베이션 펑션)**는 뉴런의 출력값을 다음 층으로 넘기기 전에 변환해주는 함수예요.

왜 필요할까요? 활성화 함수가 없으면 아무리 층을 많이 쌓아도 결국 단순한 직선 방정식의 반복에 불과합니다. 예를 들어 직선 두 개를 더해도 직선이 나오듯이요. 활성화 함수가 있어야 층을 쌓을 때 "직선으로는 표현 못 하는 복잡한 패턴"을 학습할 수 있어요. 이 성질을 **비선형성(non-linearity)**이라고 불러요.

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/9/99/ReLU_Activation_Function_Plot.svg" alt="ReLU 활성화 함수 그래프" loading="lazy"><figcaption>이 그림은 ReLU(렐루) 활성화 함수의 모양을 보여줘요. 핵심은 아주 단순하다는 것입니다. 가로축은 입력값, 세로축은 출력값이에요. 입력이 음수(왼쪽)이면 출력은 무조건 0이고, 입력이 양수(오른쪽)이면 그 값을 그대로 내보내요. 이 단순함 덕분에 계산이 빠르고 성능도 좋아서 은닉층에서 주로 씁니다. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<div class="cbox cbox-key">🔑 <b>활성화 함수 요약</b><br><br><b>ReLU(Rectified Linear Unit, 렐루)</b> — 음수 입력은 0으로, 양수는 그대로 통과해요. 계산이 단순하고 성능이 좋아서 은닉층에서 주로 써요.<br><br><b>Softmax(소프트맥스)</b> — 여러 출력값을 "합이 1인 확률 분포"로 바꿔줘요. 예: [0.7, 0.2, 0.1] 처럼 나와서 "행정일 확률 70%, 경제 20%, 복지 10%"로 해석할 수 있어요. 다중 분류(여러 클래스 중 하나를 고르는 문제)의 출력층에서 씁니다.</div>

```python
Dense(units=16, activation='relu')           # 은닉층
Dense(units=n_class, activation='softmax')   # 출력층
```

<a class="explore" href="https://playground.tensorflow.org/" target="_blank" rel="noopener">🔗 TensorFlow Playground — 신경망 실시간 학습 체험</a>

---

## 10. 임베딩 — 단어에 의미를 담은 벡터

BOW나 TF-IDF에서 단어 표현은 원-핫과 비슷한 방식이에요. "사과"가 단어 목록의 몇 번째인지만 나타낼 뿐, "사과"와 "과일"이 비슷한 단어라는 정보는 전혀 없어요.

**임베딩(embedding, 임베딩)**은 단어를 의미 관계가 담긴 작은 숫자 벡터로 바꾸는 방법이에요. 비슷한 상황에서 자주 함께 나오는 단어들은 서로 비슷한 벡터를 갖도록 학습됩니다. 예를 들어 "강아지"와 "고양이"는 둘 다 "귀여운 반려동물을 키운다"는 문장에서 자주 나오니까, 학습 후에는 비슷한 벡터 값을 갖게 돼요.

쉽게 말하면, 임베딩 공간에서 "강아지"와 "고양이"는 서로 가까운 곳에 위치하고, "비행기"는 멀리 있어요. 단어를 의미에 따라 지도 위에 배치하는 것과 같죠.

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/3/3f/Word_vector_illustration.jpg" alt="man·woman·king·queen 벡터 평행사변형" loading="lazy"><figcaption>이 그림은 임베딩의 가장 유명한 예시를 보여줘요. 핵심은 "왕(king) - 남자(man) + 여자(woman) ≈ 여왕(queen)"이라는 벡터 연산이 실제로 성립한다는 것입니다. 왕→여왕으로 향하는 화살표와 남자→여자로 향하는 화살표가 같은 방향·같은 크기라는 점에 주목하세요. 이는 성별이라는 관계가 벡터의 방향으로 인코딩(저장)되어 있다는 뜻이에요. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<div class="cbox cbox-ex">💬 <b>예시</b> — "왕 − 남자 + 여자 ≈ 여왕"이 벡터 덧셈·뺄셈으로 성립해요. 임베딩이 단어의 의미 관계를 공간적으로 담고 있다는 대표적인 증거입니다.</div>

딥러닝에서 Embedding 층은 단어 번호(정수 인덱스)를 입력받아, 학습 가능한 실수 벡터로 변환해줘요.

```python
Embedding(input_dim=vocab_size, output_dim=embedding_dim, input_length=max_length)
```

<div class="cbox cbox-def">💡 <b>파라미터</b><br><code>input_dim</code> — 단어 사전 크기예요. 단어가 몇 종류인지를 알아야 자리를 만들 수 있어요.<br><code>output_dim</code> — 각 단어를 몇 차원 벡터로 표현할지예요. 예: 64면 64개 숫자로 단어 하나를 나타냅니다. 숫자가 클수록 더 세밀하게 표현하지만 계산도 무거워져요.<br><code>input_length</code> — 입력 문장의 고정 길이예요. 패딩으로 맞춰놓은 값과 같아야 해요.</div>

원-핫 인코딩이 단어 수만큼 차원이 필요한 것과 달리, 임베딩은 훨씬 작은 차원(64, 128 등)으로 의미를 압축해서 표현해요.

<a class="explore" href="https://projector.tensorflow.org/" target="_blank" rel="noopener">🔗 TF Embedding Projector — 3D word2vec 회전·검색</a>
<a class="explore" href="https://ronxin.github.io/wevi/" target="_blank" rel="noopener">🔗 wevi — CBOW/Skip-gram 학습 애니메이션</a>
<a class="explore" href="https://jalammar.github.io/illustrated-word2vec/" target="_blank" rel="noopener">🔗 The Illustrated Word2vec — 그림으로 보는 임베딩</a>

---

## 11. 시퀀스와 RNN — 순서가 있는 데이터 처리

### 왜 순서가 중요한가

"나는 너를 좋아한다"와 "너는 나를 좋아한다"는 단어 구성은 완전히 같아요. 하지만 의미는 정반대죠. BOW는 이 둘을 전혀 구분하지 못합니다. 순서를 무시하기 때문이에요.

단어를 순서대로 처리하면 이 둘을 구분할 수 있어요. 텍스트처럼 순서가 중요한 데이터를 **시퀀스(sequence, 시퀀스)**라고 합니다.

<div class="cbox cbox-def">💡 <b>시퀀스(sequence)</b> — 텍스트, 음성, 주가처럼 순서가 있는 데이터를 말해요. 앞 단어가 뒤 단어의 의미에 영향을 줍니다. "참 좋아"와 "좋지 않아" — 같은 단어가 있어도 앞뒤 흐름이 달라지면 의미가 완전히 바뀌죠.</div>

### RNN

**RNN(Recurrent Neural Network, 알앤앤 — 순환 신경망)**은 단어를 한 번에 하나씩 순서대로 처리하면서, 이전까지 처리한 내용을 기억으로 갖고 다니는 신경망이에요. 이전 단어에서 이어받은 기억을 **은닉 상태(hidden state, h)**라고 해요. 마치 책을 왼쪽부터 오른쪽으로 읽으면서 앞 내용을 머릿속에 유지하는 것과 같아요.

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/b/b5/Recurrent_neural_network_unfold.svg" alt="RNN 시간축 펼치기" loading="lazy"><figcaption>이 그림은 RNN이 시간 순서대로 펼쳐진 모습을 보여줘요. 핵심은 각 단계(t-1, t, t+1)에서 이전 기억(h)을 받아서 새로운 기억을 만들어 다음 단계로 넘긴다는 것입니다. 왼쪽 단어에서 오른쪽으로 차례로 처리하면서 앞 문맥을 계속 기억해가는 구조예요. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<div class="cbox cbox-warn">⚠️ <b>기울기 소실 문제</b> — 문장이 길어지면 RNN은 앞부분 정보를 점점 잊어버려요.<br><br>왜 그럴까요? 9절에서 설명한 역전파 과정에서 오차 신호가 뒤에서 앞으로 전달될 때, 각 단계마다 가중치를 곱하면서 값이 점점 작아집니다. 문장이 길수록 이 곱셈이 많아져서 맨 앞 단어까지 도달하는 신호가 거의 0에 가까워져요. 이걸 <b>기울기 소실(vanishing gradient, 배니싱 그래디언트)</b>이라고 해요.<br><br>쉽게 말하면, "어제 먹은 것이 맛있었다"에서 "먹은 것"과 "맛있었다"의 관계를 RNN은 잘 파악하지만, 문장이 수십 단어로 길어지면 처음 단어가 끝부분에 영향을 못 미치는 현상이에요.</div>

### LSTM과 GRU

기울기 소실 문제를 해결하기 위해 더 발전된 구조가 나왔어요.

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/1/17/The_LSTM_Cell.svg" alt="LSTM 셀 게이트" loading="lazy"><figcaption>이 그림은 LSTM(엘에스티엠) 셀의 내부 구조를 보여줘요. 핵심은 세 개의 "게이트(문)"가 있다는 것입니다. 왼쪽 아래의 망각 게이트(forget gate, f)는 기존 기억 중 무엇을 지울지 결정하고, 입력 게이트(input gate, i)는 새 정보 중 무엇을 기억할지 결정하며, 출력 게이트(output gate, o)는 무엇을 다음 단계로 넘길지 결정해요. 이렇게 선택적으로 기억하기 때문에 긴 문장도 잘 처리해요. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<figure class="nlp-fig"><img src="https://upload.wikimedia.org/wikipedia/commons/3/37/Gated_Recurrent_Unit%2C_base_type.svg" alt="GRU 셀" loading="lazy"><figcaption>이 그림은 GRU(지알유) 셀의 구조를 보여줘요. 핵심은 LSTM의 세 게이트를 두 개로 줄인 단순화된 구조라는 것입니다. 리셋 게이트(reset gate)와 업데이트 게이트(update gate)만 있어요. LSTM보다 계산이 가볍고, 많은 경우 성능은 비슷해요. (Wikimedia Commons, CC BY-SA 4.0)</figcaption></figure>

<div class="cbox cbox-key">🔑 <b>비교</b><br><br><b>LSTM(Long Short-Term Memory, 엘에스티엠 — 장단기 기억)</b> — 게이트 3개(입력·망각·출력). 긴 문장의 문맥을 오래 기억하는 데 강해요. "Long Short-Term"은 "짧은 기억을 오래 유지한다"는 뜻이에요.<br><br><b>GRU(Gated Recurrent Unit, 지알유 — 게이트 순환 단위)</b> — 게이트 2개로 단순화한 LSTM이에요. 계산이 가볍고 성능은 비슷합니다. 데이터가 적을 때 유리하기도 해요.<br><br><b>양방향(Bidirectional, 바이디렉셔널)</b> — 앞→뒤 방향과 뒤→앞 방향을 동시에 읽어요. 앞 문맥과 뒤 문맥 모두를 고려할 수 있어서 성능이 더 좋아집니다. "오늘 날씨가 __다"에서 빈칸을 채울 때 앞 단어만이 아니라 뒷 단어도 보는 것과 같아요.</div>

```python
Bidirectional(LSTM(units=64, return_sequences=True))
```

LSTM을 두 층 쌓을 때 첫 번째 층은 `return_sequences=True`를 줘야 해요. 각 시점마다의 출력(전체 시퀀스)을 다음 층으로 넘겨주기 위해서예요. 설정하지 않으면 마지막 시점 출력만 넘겨져서 다음 층이 받아야 할 게 없어집니다.

<a class="explore" href="https://colah.github.io/posts/2015-08-Understanding-LSTMs/" target="_blank" rel="noopener">🔗 Understanding LSTM Networks — 최고 참고글</a>
<a class="explore" href="https://distill.pub/2019/memorization-in-rnns/" target="_blank" rel="noopener">🔗 RNN 기억 인터랙티브 시각화 (Distill)</a>

---

## 12. 토큰화, 정수 인코딩, OOV, 패딩

딥러닝 모델에 텍스트를 입력하려면 문장을 정수 배열로 바꾸는 세 단계를 거쳐야 해요.

<figure class="nlp-fig"><svg viewBox="0 0 680 200" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="13">
  <!-- 배경 -->
  <rect x="0" y="0" width="680" height="200" fill="#f8f9fb" rx="12"/>

  <!-- Step 1: 문장 -->
  <rect x="20" y="60" width="160" height="80" fill="#dde8f5" rx="10"/>
  <text x="100" y="48" text-anchor="middle" font-size="12" font-weight="bold" fill="#3a5a8c">① 토큰화</text>
  <text x="100" y="92" text-anchor="middle" font-size="12" fill="#3a5a8c">"나는 학교에 간다"</text>
  <text x="100" y="112" text-anchor="middle" font-size="11" fill="#5a7aac">↓ 단어 분리</text>
  <text x="100" y="130" text-anchor="middle" font-size="11" fill="#3a5a8c">["나는","학교에","간다"]</text>

  <!-- 화살표 1→2 -->
  <line x1="180" y1="100" x2="220" y2="100" stroke="#7a9abf" stroke-width="2" marker-end="url(#arr1)"/>

  <!-- Step 2: 정수 인코딩 -->
  <rect x="220" y="60" width="200" height="80" fill="#ddd5f5" rx="10"/>
  <text x="320" y="48" text-anchor="middle" font-size="12" font-weight="bold" fill="#5a3a8c">② 정수 인코딩</text>
  <text x="320" y="88" text-anchor="middle" font-size="11" fill="#5a3a8c">나는→2 / 학교에→5 / 간다→8</text>
  <text x="320" y="108" text-anchor="middle" font-size="11" fill="#7a5aac">↓ 단어ID 배열</text>
  <text x="320" y="128" text-anchor="middle" font-size="12" fill="#5a3a8c">[2, 5, 8]</text>

  <!-- 화살표 2→3 -->
  <line x1="420" y1="100" x2="460" y2="100" stroke="#7a9abf" stroke-width="2" marker-end="url(#arr1)"/>

  <!-- Step 3: 패딩 -->
  <rect x="460" y="60" width="200" height="80" fill="#d5f0e8" rx="10"/>
  <text x="560" y="48" text-anchor="middle" font-size="12" font-weight="bold" fill="#2a6a50">③ 패딩(길이=6)</text>

  <!-- 셀들 -->
  <!-- 실제 값 -->
  <rect x="470" y="78" width="28" height="28" fill="#6dbfa0" rx="5"/>
  <text x="484" y="97" text-anchor="middle" font-size="12" fill="white" font-weight="bold">2</text>
  <rect x="502" y="78" width="28" height="28" fill="#6dbfa0" rx="5"/>
  <text x="516" y="97" text-anchor="middle" font-size="12" fill="white" font-weight="bold">5</text>
  <rect x="534" y="78" width="28" height="28" fill="#6dbfa0" rx="5"/>
  <text x="548" y="97" text-anchor="middle" font-size="12" fill="white" font-weight="bold">8</text>
  <!-- 패딩 0들 -->
  <rect x="566" y="78" width="28" height="28" fill="#c8e8d8" rx="5"/>
  <text x="580" y="97" text-anchor="middle" font-size="12" fill="#888">0</text>
  <rect x="598" y="78" width="28" height="28" fill="#c8e8d8" rx="5"/>
  <text x="612" y="97" text-anchor="middle" font-size="12" fill="#888">0</text>
  <rect x="630" y="78" width="28" height="28" fill="#c8e8d8" rx="5"/>
  <text x="644" y="97" text-anchor="middle" font-size="12" fill="#888">0</text>

  <!-- 레이블 -->
  <text x="520" y="125" text-anchor="middle" font-size="10" fill="#2a6a50">← 실제 →</text>
  <text x="612" y="125" text-anchor="middle" font-size="10" fill="#888">← 패딩 0 →</text>
  <text x="560" y="145" text-anchor="middle" font-size="11" fill="#2a6a50">[2, 5, 8, 0, 0, 0]</text>

  <!-- 화살표 마커 -->
  <defs>
    <marker id="arr1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#7a9abf"/>
    </marker>
  </defs>
</svg><figcaption>이 그림은 텍스트가 모델 입력으로 바뀌는 세 단계를 보여줘요. 핵심은 ① 단어로 쪼개고(토큰화) → ② 각 단어를 번호로 바꾸고(정수 인코딩) → ③ 모든 문장이 같은 길이가 되도록 0을 채운다(패딩)는 흐름입니다. 초록 칸이 실제 단어 번호, 연한 칸이 채워넣은 0이에요.</figcaption></figure>

<figure class="nlp-fig"><img src="https://juditacs.github.io/assets/padded_sequence.png" alt="시퀀스 패딩 도식" loading="lazy"><figcaption>이 그림은 길이가 제각각인 문장들에 0을 채워 같은 길이로 맞추는 패딩 과정을 보여줘요. 핵심은 짧은 문장은 0이 많이 붙고, 긴 문장은 0이 적게 붙어서 결국 모든 행이 같은 길이(같은 열 수)가 된다는 것입니다. 신경망은 입력 크기가 고정되어야 하기 때문에 이 과정이 반드시 필요해요. (juditacs.github.io)</figcaption></figure>

### 케라스 Tokenizer

```python
from tensorflow.keras.preprocessing.text import Tokenizer

tokenizer = Tokenizer(num_words=1000, oov_token="<oov>")
tokenizer.fit_on_texts(X_train)   # 단어 사전은 train에서만

train_sequences = tokenizer.texts_to_sequences(X_train)
test_sequences  = tokenizer.texts_to_sequences(X_test)
```

<div class="cbox cbox-def">💡 <b>OOV(Out-Of-Vocabulary, 아웃오브보캐뷸러리 — 어휘 외 단어)</b> — 훈련 데이터에 없던 단어가 테스트 시점에 나오는 것을 말해요. 예를 들어 학습 때는 "자전거"라는 단어가 없었는데 테스트 때 나오면 OOV입니다. <code>oov_token="&lt;oov&gt;"</code>를 설정하면 이런 단어를 아예 버리지 않고 특수 토큰으로 대체해줘서 문장 구조가 유지돼요. 설정하지 않으면 그 단어는 그냥 사라져요.</div>

### 패딩

신경망은 입력의 크기가 일정해야 해요. "나는 간다"는 2단어, "오늘 학교에 가서 공부를 열심히 했다"는 7단어처럼, 문장마다 길이가 다르면 문제가 됩니다. **패딩(padding, 패딩)**은 짧은 문장에 0을 채워 모든 문장을 같은 길이로 맞추는 작업이에요. 옷의 패딩(솜)처럼 빈 자리를 채운다고 생각하면 돼요.

```python
from tensorflow.keras.preprocessing.sequence import pad_sequences

X_train_padded = pad_sequences(train_sequences, padding='post', maxlen=500)
```

`padding='post'`는 0을 문장 뒤에 붙이고, `'pre'`는 앞에 붙여요.

<a class="explore" href="https://tiktokenizer.vercel.app/" target="_blank" rel="noopener">🔗 Tiktokenizer — 토큰화 실시간 시각화</a>

---

## 13. 학습 과정 — epoch, batch, 손실, 옵티마이저

<div class="cbox cbox-def">💡 <b>epoch(에폭)</b> — 전체 학습 데이터를 처음부터 끝까지 한 번 다 학습하는 것이에요. 100 epoch이면 전체 데이터를 100번 반복해서 학습한다는 뜻입니다. 책 한 권을 100번 읽는다고 생각하면 돼요.<br><br><b>batch(배치)</b> — 한 번에 몇 개의 데이터를 묶어서 가중치를 업데이트할지 정하는 단위예요. batch_size=64이면 64개씩 묶어서 처리합니다. 배치를 크게 하면 학습이 안정적이지만 메모리를 많이 쓰고, 작게 하면 반대예요.</div>

### 손실 함수 — 교차 엔트로피

모델의 예측이 정답과 얼마나 다른지를 숫자로 나타내는 함수예요. 이걸 **손실 함수(loss function, 로스 펑션)**라고 해요. 손실이 클수록 예측이 틀렸다는 뜻이고, 학습은 이 손실을 줄이는 방향으로 진행돼요.

여기서 **다중 분류(multi-class classification)**란 정답이 여러 클래스(행정, 경제, 복지 등) 중 하나인 문제를 말해요. 두 클래스만 있으면 이진 분류, 세 개 이상이면 다중 분류예요.

이런 다중 분류 문제에는 **교차 엔트로피(cross-entropy, 크로스 엔트로피)**를 씁니다. 직관적으로는, 모델이 "행정일 확률 10%"라고 예측했는데 정답이 "행정"이면 손실이 크게 나오는 식이에요. 확신이 틀렸을수록 더 크게 벌점을 주는 방식이죠.

<div class="cbox cbox-key">🔑 <b>구분</b><br><code>categorical_crossentropy</code> — 정답이 원-핫 형태(예: [1,0,0])일 때 써요.<br><code>sparse_categorical_crossentropy</code> — 정답이 정수 라벨(예: 0, 1, 2)일 때 써요. 둘은 수학적으로 같지만 입력 형태가 달라요.</div>

```python
model.compile(
    loss='categorical_crossentropy',
    optimizer='adam',
    metrics=['accuracy']
)
```

**Adam(아담)** 옵티마이저는 가중치를 어떻게 업데이트할지 결정하는 알고리즘이에요. 여기서 **학습률(learning rate, 러닝 레이트)**이란 가중치를 한 번에 얼마나 크게 바꿀지를 정하는 숫자예요. 너무 크면 정답을 넘어서고, 너무 작으면 너무 느리게 학습해요. Adam은 이 학습률을 상황에 맞게 자동으로 조정해줘요. 별도 설정 없이도 대부분의 경우 잘 수렴하기 때문에 기본 선택으로 많이 씁니다.

---

## 14. 과적합 대응과 학습 평가

학습 곡선을 보면 과적합을 알아챌 수 있어요. train 정확도는 계속 오르는데 **validation(검증, 밸리데이션)** 정확도가 어느 시점부터 떨어지기 시작하면 과적합이 시작된 거예요. validation이란 train도 test도 아닌 별도의 확인용 데이터예요. 학습 중에 "지금 얼마나 잘하고 있나?"를 중간중간 체크하는 데 씁니다. 실습에서 train 0.96 / validation 0.67이 나왔다면 전형적인 과적합 신호입니다. 학습 데이터는 거의 다 맞히는데 새 데이터에는 형편없다는 뜻이거든요.

<div class="cbox cbox-def">💡 <b>과적합 대응 3가지</b><br><br><b>Dropout(드롭아웃)</b> — 학습 중에 뉴런을 무작위로 일부 끄는 방법이에요. <code>Dropout(0.2)</code>는 20%를 껐다 켰다 합니다. 특정 뉴런에 너무 의존하지 못하게 해서 외우는 걸 막아줘요. 시험 때 특정 문제만 집중적으로 외우지 말고 여러 방식으로 공부하라는 것과 같아요.<br><br><b>BatchNormalization(배치 정규화)</b> — 층을 지나는 값들이 너무 크거나 너무 작아지지 않도록 평균과 분산을 맞춰주는 방법이에요. 쉽게 말하면, 중간 계산 결과를 일정한 범위로 정돈해서 다음 층이 안정적으로 받을 수 있게 해줘요. 학습을 안정시키고 수렴을 빠르게 해줍니다.<br><br><b>EarlyStopping(얼리 스타핑 — 조기 종료)</b> — 검증 손실이 더 이상 줄어들지 않으면 학습을 일찍 멈추는 방법이에요. 불필요한 과학습을 막아줍니다.</div>

```python
from tensorflow.keras.callbacks import EarlyStopping

early_stop = EarlyStopping(monitor='val_loss', patience=5)
```

`patience=5`는 "5 에폭 동안 개선이 없으면 멈춰"라는 뜻이에요. 잠깐 성능이 출렁이는 걸 보고 바로 멈추지 않도록 여유를 주는 거예요. 보통 `epochs=100`으로 최대치를 크게 잡아두고, EarlyStopping이 적절한 시점에 알아서 멈추게 하는 게 일반적인 방법이에요.

### 평가 — 정확도와 argmax

softmax 출력은 각 클래스일 확률 배열이에요. 예: [0.05, 0.85, 0.10]. 이 중에서 가장 확률이 높은 클래스를 최종 예측으로 골라야 해요.

```python
y_pred    = model.predict(X_test_padded)
y_predict = np.argmax(y_pred, axis=1)   # 각 행에서 가장 큰 값의 위치
```

`argmax`는 "argument of maximum"의 줄임말로, "가장 큰 값이 몇 번째 자리에 있나?"를 반환해요. [0.05, 0.85, 0.10]이면 1을 반환합니다(0번째: 0.05, 1번째: 0.85 → 1번째가 가장 크니까). 원-핫 형태의 정답도 argmax로 클래스 번호로 바꾼 뒤 예측과 비교해요. 두 배열이 일치하는 비율이 **정확도(accuracy, 어큐러시)**입니다.

<a class="explore" href="https://playground.tensorflow.org/" target="_blank" rel="noopener">🔗 TensorFlow Playground — 과적합 체험</a>
<a class="explore" href="https://mlu-explain.github.io/bias-variance/" target="_blank" rel="noopener">🔗 편향-분산 트레이드오프 인터랙티브</a>

---

*이 노트는 7.1(LDA·벡터화)과 7.2(RNN·딥러닝) 실습 예상문제를 바탕으로 작성했다. 시험에서는 코드를 외우는 것보다 각 선택의 이유를 본인의 언어로 설명하는 것이 핵심이다.*
