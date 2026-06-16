# 라이브러리 명령어 — 코드 한 줄씩 왜 그렇게 쓰나

이 노트는 코드를 외우려고 만든 게 아닙니다. 각 함수와 파라미터를 **왜 이렇게 썼는지** — 교수님이 "왜 이렇게 했나요?" 하고 물었을 때 자기 말로 대답할 수 있도록 — 흐름 순서대로 정리했습니다.

코드를 처음 보면 기호와 영어가 가득해서 막막하죠. 하지만 각 줄에는 반드시 이유가 있습니다. 그 이유를 이해하면, 외우지 않아도 코드가 자연스럽게 읽힙니다.

---

## 1. 데이터 불러오기와 첫 점검 — pandas

**pandas(판다스)**란, 파이썬에서 표(스프레드시트)처럼 생긴 데이터를 다루는 도구입니다. 엑셀과 비슷하다고 생각하면 쉽습니다.

### `pd.read_csv()` / `df.shape`

```python
df = pd.read_csv("https://bit.ly/seoul-120-text-csv")
df.shape   # → (행 수, 열 수)
```

<div class="cbox cbox-key">💡 <b>왜 shape를 먼저 보나</b><br>여기서 행(row)은 민원 1건, 열(column)은 제목·내용·분류처럼 각 항목을 뜻합니다. 데이터가 예상한 규모인지 이 두 숫자로 먼저 확인합니다. 예상과 크게 다르면 파일이 잘못 불린 것이니 이후 코드를 돌려도 의미가 없습니다.</div>

### `df.dropna()`

**결측치(missing value)**란, 어떤 칸에 값이 없는 것입니다. 설문지에서 답을 안 쓴 칸과 같습니다.

```python
df = df.dropna()
df.isnull().sum()   # → 0 확인
```

<div class="cbox cbox-warn">⚠️ <b>전처리 후 반드시 검증하세요</b><br>빈 칸을 제거했다고 해도, 실제로 제거됐는지 눈으로 확인해야 합니다. <code>isnull().sum()</code>이 0이어야 비로소 안심할 수 있습니다. 빈 값이 남아 있으면 나중에 숫자로 변환하는 단계에서 오류가 나거나, 모델이 엉뚱하게 학습됩니다.</div>

### `df["분류"].value_counts()`

```python
df["분류"].value_counts()
```

<div class="cbox cbox-key">💡 <b>두 가지를 동시에 확인합니다</b><br>① <b>토픽 수 근거</b> — 실제 분류가 10종이면, 나중에 주제 분석(LDA)에서 주제 수도 그 부근으로 잡습니다. 숫자를 막연히 정하는 게 아니라 데이터를 보고 결정하는 겁니다.<br>② <b>클래스 불균형 점검</b> — 특정 분류가 13건뿐이라면 모델이 그 분류를 제대로 배우지 못합니다. 데이터가 너무 적은 분류는 미리 걸러냅니다.</div>

### `pd.get_dummies(y)` — 원-핫 인코딩

**원-핫 인코딩(one-hot encoding)**이란, 범주 이름을 숫자 배열로 바꾸는 방법입니다. "행정", "경제", "복지"처럼 이름으로 된 정답을 컴퓨터가 다루기 쉬운 숫자 형태로 바꿉니다.

```python
y_onehot = pd.get_dummies(y)
# 행정=[1,0,0], 경제=[0,1,0], 복지=[0,0,1]
```

<div class="cbox cbox-def">💡 <b>정의</b><br>해당 클래스 자리만 1, 나머지는 0으로 표현합니다. 예를 들어 분류가 3종이면 "행정"은 [1,0,0], "경제"는 [0,1,0]이 됩니다.<br><br>쉽게 말하면: "행정=0, 경제=1, 복지=2"처럼 단순 번호(라벨 인코딩)를 쓰면, 모델이 "2가 0보다 크다"고 오해할 수 있습니다. 분류는 크고 작음이 없으니, 원-핫으로 표현해야 공평합니다.</div>

<div class="cbox cbox-key">💡 <b>왜 원-핫인가</b><br>나중에 출력층에서 쓸 softmax(소프트맥스)와 categorical_crossentropy(카테고리컬 크로스엔트로피) 조합이 원-핫 정답과 짝을 이루는 표준 방식입니다. 이 용어는 12절에서 자세히 다룹니다.</div>

---

## 2. 학습/테스트 분리 — `train_test_split`

모델을 만들 때는 "학습용 데이터"와 "시험용 데이터"를 반드시 나눠야 합니다. 같은 데이터로 학습하고 평가하면, 시험 문제와 정답을 미리 외운 것과 같아서 점수가 부풀려집니다.

```python
X_train, X_test, y_train, y_test = train_test_split(
    X, y_onehot, test_size=0.2, random_state=42, stratify=y_onehot
)
```

| 파라미터 | 값 | 쉽게 말하면 |
|---|---|---|
| `test_size` | 0.2 | 전체의 20%를 시험용으로 남겨둡니다. 같은 데이터로 배우고 시험 보면 성적이 부풀려지니까요 |
| `random_state` | 42 | 무작위로 나누되, 매번 같은 방식으로 나눕니다. 숫자 42 자체에는 의미 없고, 누가 돌려도 같은 결과가 나오도록 시드(seed, 난수 출발점)를 고정한 겁니다 |
| `stratify` | y_onehot | 원본에서 각 분류가 차지하는 비율을 학습·테스트 양쪽에 똑같이 유지합니다. 안 하면 특정 분류가 한쪽에 몰릴 수 있습니다 |

<div class="cbox cbox-warn">⚠️ <b>stratify를 빼면</b><br>드문 분류가 우연히 테스트 세트에만 몰릴 수 있습니다. 그러면 "이 분류는 잘 맞혔다"는 평가가 실제보다 왜곡됩니다.</div>

---

## 3. 단어 세기 — CountVectorizer

**CountVectorizer(카운트 벡터라이저)**란, 문서에 각 단어가 몇 번 나왔는지 세어서 숫자 표로 만드는 도구입니다. 컴퓨터는 문자를 직접 이해하지 못하니, 숫자 표로 바꿔야 처리할 수 있습니다.

예를 들어 "서울 복지 서울"이라는 문장이 있다면, "서울"=2, "복지"=1처럼 각 단어의 등장 횟수를 세는 겁니다.

```python
from sklearn.feature_extraction.text import CountVectorizer

cv = CountVectorizer(
    analyzer='word',
    ngram_range=(1, 2),
    min_df=0.01,
    max_df=0.9,
    stop_words=["돋움", "경우", "또는"]
)
dtm_cv = cv.fit_transform(df["문서"])
```

이렇게 만들어진 숫자 표를 **문서-단어 행렬(DTM, Document-Term Matrix)**이라고 합니다. 행은 문서 하나하나, 열은 단어 하나하나이고, 각 칸에는 "그 문서에서 그 단어가 몇 번 나왔는지"가 들어갑니다.

그런데 단순히 횟수만 세면 문제가 있습니다. "입니다", "있습니다"처럼 아무 문서에나 흔히 나오는 단어도 많이 나오면 높은 숫자를 받습니다. 이 흔한 단어는 문서를 구별하는 데 아무 도움이 안 됩니다. 그래서 다음 섹션에서 배울 TF-IDF가 필요합니다.

아래 그림은 바로 그 문제, 즉 "흔한 단어를 어떻게 걸러낼까"를 시각적으로 설명합니다.

<figure class="nlp-fig">
<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Plot_IDF_functions.png/500px-Plot_IDF_functions.png" alt="IDF 함수 곡선 — 문서 빈도가 높아질수록 IDF 가중치가 급격히 낮아짐" loading="lazy">
<figcaption>이 그림은 IDF(역문서빈도, Inverse Document Frequency) 값이 어떻게 달라지는지를 보여줍니다. <b>가로축</b>은 "전체 문서 중 그 단어가 나온 문서의 비율"이고, <b>세로축</b>은 IDF 점수입니다. 여기서 핵심은, 많은 문서에 흔히 등장하는 단어일수록(가로축 오른쪽) IDF 값이 0에 가까워진다는 것입니다. 즉, 어디서나 나오는 단어는 "문서를 구별하는 힘"이 거의 없다는 뜻입니다. 반대로 드문 단어일수록(가로축 왼쪽) 높은 점수를 받아 중요하게 취급됩니다. <small>(Wikimedia)</small></figcaption>
</figure>

<a class="explore" href="https://remykarem.github.io/tfidf-demo/" target="_blank" rel="noopener">🔗 TF-IDF 4문서 실시간 계산기 — min_df/max_df 효과를 직접 확인</a>

### 파라미터별 핵심

<div class="cbox cbox-key">💡 <b>analyzer='word'</b><br>띄어쓰기를 기준으로 단어 단위로 나눕니다. 예를 들어 "서울시 복지 서비스"는 "서울시", "복지", "서비스" 세 덩어리로 쪼개집니다. <code>'char'</code>로 바꾸면 글자 한 자씩 쪼개는 방식인데, 오타가 많은 텍스트에 씁니다.</div>

<div class="cbox cbox-key">💡 <b>ngram_range=(1,2)</b><br>N-그램(N-gram)이란, 단어를 N개씩 묶어서 보는 방법입니다. (1,2)이면 단어 1개짜리(유니그램)와 2개짜리(바이그램)를 함께 씁니다.<br>예: "서울 시청"에서 "서울"과 "시청"을 따로 볼 때와 "서울 시청"을 하나로 볼 때 의미가 다릅니다. 2개 단위까지 보면 이런 연결 표현을 잡아낼 수 있습니다. (1,3) 이상은 경우의 수가 폭발적으로 늘어나 과적합(모델이 학습 데이터를 과하게 외우는 현상) 위험이 있습니다.</div>

<div class="cbox cbox-key">💡 <b>min_df=0.01 (소수로 쓸 때)</b><br>"전체 문서의 1% 이상에 나온 단어만 포함하라"는 뜻입니다. 정수(예: 2)로 쓰면 "문서 2개 이상에 나온 것만"인데, 데이터 크기가 달라지면 기준이 흔들립니다. 소수로 쓰면 비율 기준이 되어 데이터가 바뀌어도 일관성이 유지됩니다.</div>

<div class="cbox cbox-key">💡 <b>max_df=0.9 (소수로 쓸 때)</b><br>"90% 이상의 문서에 등장하는 단어는 제외하라"는 뜻입니다. 거의 모든 문서에 나오는 단어는 문서를 서로 구별하는 능력이 없습니다. 예를 들어 "입니다", "했습니다"처럼 어디서나 나오는 단어는 분류에 도움이 안 됩니다.</div>

<div class="cbox cbox-ex">📌 <b>stop_words 예시</b><br>"돋움"은 원본 텍스트에 글꼴 이름이 섞인 노이즈입니다. "경우"·"또는"은 의미 없는 연결 표현입니다. 이런 단어를 직접 목록으로 지정해 제거합니다. 한국어 형태소 분석기를 쓰면 더 체계적으로 처리할 수 있지만, 여기서는 간단히 수동으로 지정했습니다.</div>

---

## 4. fit / transform / fit_transform — 세 가지 차이

이 세 메서드(method, 함수)를 혼동하기 쉽습니다. **데이터 누수(data leakage)**라는 핵심 개념과 연결되어 있어서 꼭 이해해야 합니다.

데이터 누수란, 모델이 시험을 보기 전에 시험 문제를 미리 본 것과 같은 상황입니다. 이를 막으려면 사전(단어 목록)은 학습 데이터에서만 만들어야 합니다.

```python
# 학습 데이터: 사전을 만들고 동시에 변환
dtm_cv = cv.fit_transform(X_train)

# 테스트 데이터: 만든 사전으로 변환만
dtm_test = cv.transform(X_test)
```

| 메서드 | 하는 일 | 언제 씁니까 |
|---|---|---|
| `fit` | 데이터를 보고 단어 사전(어휘 목록)을 학습합니다 | 단독으로 쓸 일은 거의 없습니다 |
| `transform` | 이미 만들어진 사전으로 문서를 숫자 행렬로 바꿉니다 | 테스트 데이터에 적용할 때 |
| `fit_transform` | fit과 transform을 한 번에 합니다 (더 효율적) | 학습 데이터에만 씁니다 |

<div class="cbox cbox-warn">⚠️ <b>데이터 누수(data leakage)란</b><br>테스트 데이터에도 fit을 새로 하면, 테스트 전용 단어가 사전에 들어갑니다. 이는 시험 문제를 미리 본 것과 같아서 모델 성능이 실제보다 좋게 나옵니다. 사전은 학습 데이터에서 딱 한 번만 만들어야 합니다.</div>

### `get_feature_names_out()`

```python
cv_cols = cv.get_feature_names_out()
```

<div class="cbox cbox-def">💡 <b>정의</b><br>벡터화 결과는 숫자만 가득한 행렬입니다. 이 함수는 "몇 번째 열이 어떤 단어인지"를 알려줍니다. 예를 들어 3번째 열이 "복지"라는 걸 알아야 결과를 해석할 수 있습니다. 구버전 scikit-learn(1.0.0 미만)에서는 <code>get_feature_names()</code>를 씁니다.</div>

---

## 5. 가중치 반영 — TfidfVectorizer

CountVectorizer는 단순히 단어 개수를 셉니다. 그런데 "입니다", "그리고"처럼 어디서나 흔한 단어도 많이 나오면 높은 점수를 받습니다. 이 문제를 해결한 것이 **TF-IDF(티에프 아이디에프)**입니다.

**TF-IDF**란, "그 문서에서는 자주 나오지만, 전체 문서에서는 드문 단어"에 높은 점수를 주는 방법입니다. 즉, 문서를 구별하는 데 진짜 도움이 되는 단어를 골라내는 방식입니다.

- **TF(Term Frequency, 단어 빈도)**: 한 문서 안에서 특정 단어가 몇 번 나왔는지. 많이 나올수록 값이 커집니다.
- **IDF(Inverse Document Frequency, 역문서빈도)**: 전체 문서 중 그 단어가 나온 문서가 적을수록 높아지는 값. "역(Inverse)"이라는 말은 "문서 빈도의 반대"라는 뜻으로, 흔할수록 낮아집니다.

TF-IDF 점수는 이 둘을 곱한 값입니다. 쉽게 설명하면:

> "이 문서에서는 자주(TF↑), 그런데 다른 문서들에서는 잘 안 쓰이는(IDF↑) 단어" → 점수가 높다 → "이 문서를 특징짓는 핵심 단어"

반대로 "입니다"처럼 모든 문서에서 흔하면: TF는 높아도 IDF가 거의 0이라 최종 점수가 낮습니다.

```python
from sklearn.feature_extraction.text import TfidfVectorizer

tfidf = TfidfVectorizer(
    stop_words=[...],
    norm='l2',
    smooth_idf=True,
    sublinear_tf=True,
    use_idf=True
)
dtm_tfidf = tfidf.fit_transform(df["문서"])
```

<div class="cbox cbox-def">💡 <b>TF-IDF 핵심 통찰</b><br>"모든 문서에 흔히 나오는 단어는 문서를 구별하는 힘이 없다." TF(단어 빈도)에 IDF(역문서빈도)를 곱해서, 특정 문서에만 자주 나오는 단어는 점수가 올라가고, 어디서나 흔한 단어는 점수가 낮아집니다.</div>

<a class="explore" href="https://melaniewalsh.github.io/Intro-Cultural-Analytics/05-Text-Analysis/03-TF-IDF-Scikit-Learn.html" target="_blank" rel="noopener">🔗 TF-IDF 히트맵 교재 — 문서별 단어 가중치 시각화</a>

### 파라미터별 핵심

<div class="cbox cbox-key">💡 <b>norm='l2'</b><br>정규화(normalization)란, 값의 크기를 고르게 맞추는 작업입니다.<br>긴 문서는 단어 빈도 값이 전반적으로 커서 짧은 문서와 불공평하게 비교될 수 있습니다. 예를 들어 100단어짜리 문서와 1000단어짜리 문서를 비교하면, 단순 숫자로는 긴 문서가 무조건 커 보입니다.<br>l2 정규화는 각 문서의 TF-IDF 벡터 전체를 조정해서, 어떤 문서든 벡터 길이가 1이 되도록 맞춥니다. 이렇게 하면 문서 길이 차이를 없애고 단어 구성 비율만 비교할 수 있습니다.</div>

<div class="cbox cbox-key">💡 <b>smooth_idf=True</b><br>IDF를 계산할 때 분모에 1을 더합니다. 어떤 단어가 딱 한 문서에만 나왔을 때 0으로 나누는 오류가 생기지 않도록 막는 안전장치입니다. 기본값 True를 유지하면 됩니다.</div>

<div class="cbox cbox-key">💡 <b>sublinear_tf=True</b><br>TF에 로그(log)를 씌웁니다. 수식으로는 <code>1 + log(tf)</code>입니다.<br>로그란, 지수의 반대 개념입니다. 10 → log(10) ≈ 2.3, 100 → log(100) ≈ 4.6처럼 큰 숫자를 훨씬 작은 숫자로 압축합니다.<br>직관적으로: "서울"이 10번 나왔다고 해서 5번보다 정확히 2배 중요한 건 아닙니다. 지나치게 많이 나온 단어가 점수를 독식하지 않도록 완만하게 조정합니다.</div>

<div class="cbox cbox-key">💡 <b>use_idf=True</b><br>IDF를 실제로 곱할지 결정합니다. False로 하면 TF만 남아서 단순 빈도 계산인 CountVectorizer와 거의 같아집니다. "흔한 단어를 억누르기"가 TF-IDF의 핵심이니 True로 유지합니다.</div>

### CountVectorizer vs TfidfVectorizer — 언제 어느 것을

<div class="cbox cbox-ex">📌 <b>LDA(주제 분석) → CountVectorizer</b><br>LDA는 "단어가 몇 번 등장했는지"라는 정수 빈도를 기반으로 확률을 계산합니다. TF-IDF처럼 실수 가중치가 섞이면 이 이론 가정과 어긋납니다.<br><br>📌 <b>코사인 유사도(문서 비교) → TfidfVectorizer</b><br>문서끼리 비교할 때는 변별력 있는 단어에 높은 가중치를 줘야 더 정확합니다. TF-IDF가 이 역할을 합니다.</div>

---

## 6. 토픽 모델링 — LatentDirichletAllocation

**토픽 모델링(topic modeling)**이란, 여러 문서를 분석해서 "이 문서들에는 어떤 주제들이 숨어 있는가"를 자동으로 찾아내는 방법입니다.

잠깐, 여기서 중요한 개념을 먼저 짚겠습니다. 머신러닝에는 크게 두 가지 방식이 있습니다.

- **지도 학습(supervised learning)**: 정답 라벨이 있는 데이터로 배웁니다. 예: "이 민원은 복지 분야"라고 정답이 달린 데이터로 분류를 학습합니다.
- **비지도 학습(unsupervised learning)**: 정답 라벨 없이, 데이터의 패턴만 보고 스스로 구조를 찾아냅니다. 사람이 "이게 주제야"라고 알려주지 않아도, 비슷한 단어끼리 묶어서 주제를 발견합니다.

토픽 모델링은 비지도 학습입니다. 정답 없이 단어 분포만 보고 주제를 찾습니다.

**LDA(엘디에이 — Latent Dirichlet Allocation, 잠재 디리클레 할당)**는 토픽 모델링 중 가장 유명한 방식입니다. 이름이 어렵지만, 핵심 아이디어는 이렇습니다.

> "각 문서는 여러 주제가 혼합된 것이고, 각 주제는 특정 단어들이 자주 나오는 패턴이다."

예를 들어 어떤 민원 문서를 LDA로 분석하면, "주제1(복지) = 지원·신청·혜택", "주제2(교통) = 버스·노선·정류장" 같은 단어 묶음이 자동으로 나타납니다. '잠재(Latent)'라는 말은 눈에 보이지 않는 숨어 있는 구조를 찾는다는 뜻이고, '디리클레(Dirichlet)'는 이 계산에 쓰이는 수학적 확률 분포의 이름입니다(수식 자체는 몰라도 됩니다).

```python
from sklearn.decomposition import LatentDirichletAllocation

NUM_TOPICS = 10
LDA_model = LatentDirichletAllocation(
    n_components=NUM_TOPICS, max_iter=10, random_state=42
)
LDA_model.fit(dtm_cv)
```

<div class="cbox cbox-def">💡 <b>LDA란</b><br>비지도 학습입니다. 정답 라벨 없이, 단어 분포만 보고 숨어 있는 주제를 찾습니다. "각 문서는 여러 주제의 혼합이고, 각 주제는 특정 단어들이 자주 나오는 분포"라는 아이디어에서 출발합니다.</div>

<a class="explore" href="https://nbviewer.org/github/bmabey/pyLDAvis/blob/master/notebooks/pyLDAvis_overview.ipynb" target="_blank" rel="noopener">🔗 pyLDAvis 인터-토픽 거리맵 노트북 — 토픽 간 거리와 단어 분포 인터랙티브 확인</a>

| 파라미터 | 값 | 쉽게 말하면 |
|---|---|---|
| `n_components` | 10 | 찾을 주제의 수입니다. 앞서 `value_counts()`로 실제 분류가 10종임을 확인하고 결정한 숫자입니다. 너무 적으면 여러 주제가 뭉치고, 너무 많으면 비슷한 주제가 쪼개집니다 |
| `max_iter` | 10 | 반복 학습을 최대 몇 번 할지입니다. 늘리면 결과가 더 안정적이지만 시간이 오래 걸립니다 |
| `random_state` | 42 | 무작위 초기값을 고정해 누가 돌려도 같은 결과가 나오게 합니다 |

---

## 7. 코사인 유사도 — `cosine_similarity`

먼저 **벡터(vector)**라는 개념을 이해해야 합니다. 벡터란, 여러 숫자를 순서 있게 나열한 것입니다. 방향과 크기를 가진 화살표로 표현할 수 있습니다. 예를 들어 [2, 5, 0, 3]은 4개의 숫자로 이루어진 벡터입니다. 앞에서 문서를 숫자 표로 바꾼 결과물이 바로 벡터입니다.

**코사인 유사도(cosine similarity)**란, 두 벡터(화살표)가 이루는 각도를 이용해 "두 문서가 얼마나 비슷한지"를 -1에서 1 사이의 값으로 나타내는 방법입니다.

비유하자면, 두 사람이 가리키는 방향이 얼마나 같은지를 봅니다. 방향이 완전히 같으면 유사도 1(가장 비슷함), 직각이면 0(공통점 없음), 반대 방향이면 -1입니다.

```python
from sklearn.metrics.pairwise import cosine_similarity

similarity = cosine_similarity(dtm_tfidf[0], dtm_tfidf)
```

<figure class="nlp-fig">
<img src="https://storage.googleapis.com/lds-media/images/cosine-similarity-vectors.original.jpg" alt="코사인 유사도 세 케이스 — 각도 0°(유사도 1), 90°(유사도 0), 180°(유사도 -1)" loading="lazy">
<figcaption>이 그림은 두 벡터의 각도에 따라 코사인 유사도 값이 어떻게 달라지는지를 보여줍니다. 여기서 핵심은 세 가지 경우를 비교하는 것입니다. 두 화살표가 같은 방향(각도 0°)이면 유사도 1 — 문서 내용이 거의 같습니다. 직각(90°)이면 유사도 0 — 공통점이 없습니다. 반대 방향(180°)이면 유사도 -1입니다. 텍스트 비교에서는 음수가 잘 나오지 않아 보통 0~1 범위를 봅니다. <small>(LearnDataSci)</small></figcaption>
</figure>

<a class="explore" href="https://dejan.ai/tools/cosine/" target="_blank" rel="noopener">🔗 벡터 드래그 코사인 유사도 인터랙티브 — 벡터 방향을 바꾸며 값 변화 체험</a>

<div class="cbox cbox-def">💡 <b>왜 유클리드 거리 대신 코사인인가</b><br><b>유클리드 거리(Euclidean distance)</b>란 두 점 사이의 직선 거리입니다. 긴 문서는 단어 빈도 값이 전반적으로 커서, 짧은 문서와 단순 거리를 재면 무조건 멀게 나옵니다. 코사인 유사도는 절대적 크기(문서 길이)를 무시하고 <b>벡터의 방향(단어 구성 비율)</b>만 비교합니다. 그래서 문서 길이가 달라도 내용이 비슷하면 높은 유사도가 나옵니다.</div>

<div class="cbox cbox-key">💡 <b>사용 방법</b><br><code>dtm_tfidf[0]</code>은 0번 문서 벡터입니다. 이것과 전체 문서를 비교하면 "0번 문서와 모든 문서 간의 유사도"가 한 번에 나옵니다. 자기 자신과의 유사도는 항상 1.0이므로, 실제로 비슷한 문서는 2위부터 찾아봅니다.</div>

---

## 8. 케라스 Tokenizer — 텍스트를 숫자로

**신경망(neural network)**이란, 인간 뇌의 뉴런(neuron, 신경 세포) 연결 구조를 수학적으로 흉내 낸 모델입니다. 뇌가 뉴런들의 연결을 통해 정보를 처리하듯, 신경망도 숫자 연산을 여러 층(layer)으로 연결해서 패턴을 학습합니다. 이 신경망은 문자열을 직접 처리하지 못합니다. 모든 입력이 숫자여야 합니다. 단어를 정수 번호로 바꾸는 첫 번째 단계가 **토크나이저(Tokenizer)**입니다.

**토큰화(tokenization)**란, 문장을 더 작은 단위(토큰)로 쪼개는 것입니다. 여기서는 단어 단위로 쪼개고, 각 단어에 번호를 붙입니다.

<figure class="nlp-fig">
<img src="https://raw.githubusercontent.com/mrdbourke/tensorflow-deep-learning/main/images/08-tokenization-vs-embedding.png" alt="토큰화 vs 임베딩 대조 — 문자열이 정수 인덱스로, 다시 실수 벡터로 변환되는 두 단계" loading="lazy">
<figcaption>이 그림은 텍스트가 신경망에 들어가기까지의 두 단계를 보여줍니다. 여기서 핵심은 두 단계의 차이입니다. 왼쪽(토큰화)에서는 "고양이"→23처럼 단어에 단순 번호를 붙입니다. 오른쪽(임베딩)에서는 그 번호 23을 [0.2, -0.5, 0.8, ...]처럼 의미를 담은 실수 배열로 바꿉니다. 번호만으로는 단어 간 의미 관계를 알 수 없지만, 임베딩 벡터는 비슷한 단어가 비슷한 숫자 배열을 갖도록 학습됩니다. <small>(MIT License)</small></figcaption>
</figure>

<a class="explore" href="https://tiktokenizer.vercel.app/" target="_blank" rel="noopener">🔗 tiktokenizer — 텍스트 입력 시 토큰 분리 과정을 실시간으로 시각화</a>

```python
from tensorflow.keras.preprocessing.text import Tokenizer

vocab_size = 1000
tokenizer = Tokenizer(num_words=vocab_size, oov_token="<oov>")
tokenizer.fit_on_texts(X_train)   # 사전 생성 — train에만!
```

<div class="cbox cbox-key">💡 <b>num_words=1000</b><br>빈도 순으로 상위 1000개 단어만 사전에 포함합니다. 크게 잡으면 더 많은 단어를 표현할 수 있지만 노이즈도 늘어나고, 작게 잡으면 가볍지만 중요한 단어가 빠질 수 있습니다. 데이터 규모에 맞게 조정합니다.</div>

<div class="cbox cbox-key">💡 <b>oov_token="&lt;oov&gt;"</b><br>OOV는 "Out-Of-Vocabulary(아웃 오브 보캐뷸러리 — 사전에 없는 단어)"의 줄임말입니다. 테스트 데이터에 사전에 없는 단어가 나오면 그 자리를 "&lt;oov&gt;" 기호로 표시합니다. 설정하지 않으면 그 단어가 그냥 사라져서 문장 구조가 깨집니다.</div>

<div class="cbox cbox-warn">⚠️ <b>fit_on_texts는 X_train에만</b><br>테스트 데이터까지 넣으면 데이터 누수가 됩니다. 사전은 학습 데이터에서 한 번만 만들고, 테스트는 그 사전으로 변환만 합니다.</div>

```python
train_sequences = tokenizer.texts_to_sequences(X_train)
test_sequences = tokenizer.texts_to_sequences(X_test)
# "서울시 복지 서비스" → [23, 456, 7]
```

---

## 9. 길이 맞추기 — `pad_sequences`

**패딩(padding)**이란, 서로 다른 길이의 문장을 같은 길이로 맞추기 위해 빈 자리를 0으로 채우는 작업입니다.

신경망은 입력 크기가 항상 일정해야 합니다. 그런데 문장마다 단어 수가 다르면 정수열 길이도 제각각입니다. 이를 해결하기 위해 짧은 문장은 0을 붙여 늘리고, 긴 문장은 잘라냅니다.

```python
from tensorflow.keras.preprocessing.sequence import pad_sequences

max_length = 500
X_train_sp = pad_sequences(train_sequences, padding='post', maxlen=max_length)
X_test_sp  = pad_sequences(test_sequences,  padding='post', maxlen=max_length)
```

<figure class="nlp-fig">
<img src="https://juditacs.github.io/assets/padded_sequence.png" alt="시퀀스 패딩 도식 — 짧은 문장 뒤를 0으로 채워 모든 행을 같은 길이로 맞춤" loading="lazy">
<figcaption>이 그림은 패딩 작업을 보여줍니다. 여기서 핵심은, 각 줄(문장)의 길이가 제각각인 것을 0을 뒤에 붙여서 모두 같은 길이로 맞춘다는 것입니다. 색칠된 부분은 실제 단어 번호이고, 흰 부분(0)이 패딩입니다. 이렇게 해야 신경망이 균일한 크기의 입력을 받을 수 있습니다.</figcaption>
</figure>

<div class="cbox cbox-def">💡 <b>왜 패딩이 필요한가</b><br>문장마다 단어 수가 달라 정수열 길이가 제각각입니다. 신경망은 입력 크기가 항상 일정해야 합니다. 짧은 문장은 0으로 채우고, 긴 문장은 잘라냅니다.</div>

<div class="cbox cbox-key">💡 <b>maxlen=500</b><br>실제 문장 길이 분포를 보고 대부분의 문장을 커버하는 값으로 정합니다. 너무 크면 0이 잔뜩 들어가 계산이 낭비되고, 너무 작으면 긴 문서의 뒷부분 정보가 잘려나갑니다.</div>

<div class="cbox cbox-key">💡 <b>padding='post' vs 'pre'</b><br><code>'post'</code>는 뒤쪽에 0을 채웁니다. <code>'pre'</code>는 앞쪽에 채웁니다. RNN(순환 신경망, 11절에서 자세히 다룸) 계열 모델은 마지막 시점의 출력이 최종 결과에 크게 영향을 미칩니다. 의미 있는 단어가 앞에 오고 뒤를 0으로 채우는 <code>'post'</code>가 일반적으로 쓰입니다.</div>

---

## 10. 단어를 벡터로 — Embedding 층

토크나이저 단계에서는 단어에 번호만 붙였습니다. 그런데 번호 자체에는 의미가 없습니다. "서울"이 23번, "도시"가 24번이라고 해서 두 단어가 비슷한 게 아니죠.

**임베딩(embedding)**이란, 각 단어 번호를 "의미를 담은 실수 벡터(숫자 배열)"로 변환하는 층입니다. 비유하자면, 지도에서 각 도시의 위치를 좌표로 나타내듯이, 단어의 의미를 숫자 좌표로 표현합니다. 비슷한 의미의 단어는 비슷한 좌표를 갖도록 학습됩니다.

**차원(dimension)**이란, 그 좌표계에서 숫자 몇 개로 위치를 나타내는지입니다. 지도 위치는 (위도, 경도) 2개 숫자로 표현하므로 2차원입니다. 임베딩에서 64차원이라면, 각 단어의 의미를 숫자 64개짜리 배열로 표현한다는 뜻입니다. 차원이 클수록 더 세밀한 의미를 담을 수 있지만, 학습할 숫자도 늘어납니다.

```python
from tensorflow.keras.layers import Embedding

embedding_dim = 64
Embedding(input_dim=vocab_size, output_dim=embedding_dim, input_length=max_length)
```

<div class="cbox cbox-def">💡 <b>임베딩이란</b><br>정수 번호만으로는 단어 간 의미 관계를 알 수 없습니다. 임베딩 층은 각 번호를 <b>의미를 담은 실수 벡터</b>로 바꿉니다. 비슷한 문맥에서 쓰이는 단어는 비슷한 벡터를 갖도록 학습을 통해 자동으로 조정됩니다.</div>

<a class="explore" href="https://projector.tensorflow.org/" target="_blank" rel="noopener">🔗 TF Embedding Projector — 3D 공간에서 단어 벡터를 회전·검색</a>

<a class="explore" href="https://jalammar.github.io/illustrated-word2vec/" target="_blank" rel="noopener">🔗 The Illustrated Word2vec — 임베딩 학습 과정을 그림으로</a>

| 파라미터 | 의미 |
|---|---|
| `input_dim=vocab_size` | 사전의 단어 수 = 임베딩 표(행렬)의 행 수. 단어 1000개 → 표의 행이 1000줄 |
| `output_dim=embedding_dim` | 각 단어를 몇 차원 벡터로 표현할지입니다. 64면 숫자 64개짜리 배열. 크면 표현력이 높아지지만 과적합 위험도 커집니다 |
| `input_length=max_length` | 한 문장의 길이(패딩으로 맞춘 500). 모델이 입력 형태를 미리 알 수 있도록 지정합니다 |

---

## 11. 모델 구성 — Sequential, Dense, LSTM

### Sequential

```python
from tensorflow.keras.models import Sequential
model = Sequential()
```

<div class="cbox cbox-def">💡 <b>Sequential(시퀀셜)</b><br>층(layer)을 순서대로 일직선으로 쌓는 가장 단순한 모델 구조입니다. 입력이 첫 번째 층을 통과하면 그 출력이 두 번째 층으로 넘어가는 방식입니다. 분기나 합류 없이 직선으로 이어지는 구조에 쓰입니다.</div>

<a class="explore" href="https://playground.tensorflow.org/" target="_blank" rel="noopener">🔗 TensorFlow Playground — 층 수·뉴런 수·활성화 함수를 바꾸며 신경망 학습을 실시간 체험</a>

### Dense — 완전 연결층

**Dense(덴스) 층**이란, 이전 층의 모든 뉴런이 다음 층의 모든 뉴런과 연결된 구조입니다. 여기서 **뉴런(neuron)**이란, 신경망을 이루는 기본 계산 단위입니다. 여러 숫자를 받아서 하나의 숫자를 출력합니다. Dense를 "완전 연결층"이라고도 합니다. 모든 입력 정보를 조합해서 새로운 표현을 만드는 역할을 합니다.

그리고 이 연결에는 **가중치(weight)**가 붙습니다. 가중치란, "어떤 입력을 얼마나 중요하게 볼 것인지"를 나타내는 숫자입니다. 모델 학습이란 결국 이 가중치 숫자들을 정답에 가깝게 조금씩 수정해 가는 과정입니다.

```python
Dense(units=16, activation='relu')         # 중간 층
Dense(units=n_class, activation='softmax') # 출력 층
```

<div class="cbox cbox-key">💡 <b>activation='relu'</b><br><b>활성화 함수(activation function)</b>란, 층을 통과한 값에 비선형성을 더해주는 함수입니다. 쉽게 말하면, 직선 계산만 반복하면 결과도 결국 직선이 됩니다. 활성화 함수를 끼워 넣으면 복잡한 곡선 패턴을 배울 수 있게 됩니다.<br>ReLU(렐루 — Rectified Linear Unit)는 음수 입력을 0으로, 양수는 그대로 통과시킵니다. 계산이 빠르고 깊은 네트워크에서 잘 작동합니다.</div>

<div class="cbox cbox-key">💡 <b>activation='softmax'</b><br>소프트맥스(softmax)는 출력 값들의 합이 1이 되는 확률 분포로 바꿉니다. 예: [0.1, 0.7, 0.2] → "2번째 클래스일 확률 70%". <b>다중 분류 출력층의 표준</b>입니다. units 수를 분류 클래스 수와 꼭 맞춰야 합니다.</div>

### LSTM과 return_sequences

일반적인 신경망은 입력 순서를 무시합니다. 그런데 텍스트는 단어 순서가 의미에 영향을 미칩니다. "나는 너를 좋아해"와 "너는 나를 좋아해"는 단어가 같아도 순서가 달라 의미가 다릅니다.

**RNN(Recurrent Neural Network, 순환 신경망)**은 이전 시점의 정보를 다음 시점으로 전달하는 구조입니다. 단어를 한 개씩 순서대로 처리하면서, 앞에서 본 내용을 기억해 다음 단어 처리에 활용합니다.

그런데 일반 RNN은 문장이 길어질수록 앞부분 내용을 점점 잊어버립니다. 이를 **기울기 소실(vanishing gradient)** 문제라고 합니다. 기울기란 "가중치를 얼마나 수정할지"를 나타내는 신호입니다. 문장이 길어지면 이 신호가 앞쪽 가중치까지 전달되는 과정에서 점점 작아져서, 결국 0에 가까워지고 앞부분을 학습하지 못합니다. 마치 귓속말이 사람을 많이 거칠수록 내용이 흐릿해지는 것과 같습니다.

**LSTM(엘에스티엠 — Long Short-Term Memory, 장단기 기억망)**은 이 문제를 해결한 개선된 RNN입니다.

```python
LSTM(units=64, return_sequences=True)   # 첫 번째 층
LSTM(units=64)                          # 마지막 층
```

<figure class="nlp-fig">
<img src="https://upload.wikimedia.org/wikipedia/commons/b/b5/Recurrent_neural_network_unfold.svg" alt="RNN 시간축 펼치기 — 동일한 셀이 각 시점에서 반복되며 이전 상태를 다음 시점으로 전달" loading="lazy">
<figcaption>이 그림은 RNN이 단어를 순서대로 처리하는 방식을 시간축을 펼쳐서 보여줍니다. 여기서 핵심은, 가운데 네모(같은 셀)가 단어 하나를 처리할 때마다 오른쪽 화살표로 "기억"을 다음 시점에 넘겨준다는 것입니다. 예를 들어 3번째 단어를 처리할 때, 1번째·2번째 단어에서 만들어진 정보가 이미 들어와 있습니다. 이런 방식으로 앞에서 나온 단어를 기억하면서 읽어나갑니다. <small>(Wikimedia, CC BY-SA 4.0)</small></figcaption>
</figure>

<figure class="nlp-fig">
<img src="https://upload.wikimedia.org/wikipedia/commons/1/17/The_LSTM_Cell.svg" alt="LSTM 셀 — 입력·망각·출력 게이트로 어떤 정보를 기억하고 버릴지 제어" loading="lazy">
<figcaption>이 그림은 LSTM 셀 내부 구조를 보여줍니다. 여기서 핵심은 세 개의 게이트(문)입니다. 게이트(gate)란, "정보를 얼마나 통과시킬지"를 0~1 사이 값으로 조절하는 장치입니다. 망각 게이트(forget gate)는 기존 기억에서 버릴 것을 결정하고, 입력 게이트(input gate)는 새 정보를 얼마나 받아들일지 결정하고, 출력 게이트(output gate)는 무엇을 다음 시점으로 내보낼지 결정합니다. 이 세 문을 통해 긴 문장에서도 중요한 정보만 선택적으로 기억할 수 있습니다. <small>(Wikimedia, CC BY-SA 4.0)</small></figcaption>
</figure>

<a class="explore" href="https://colah.github.io/posts/2015-08-Understanding-LSTMs/" target="_blank" rel="noopener">🔗 Understanding LSTM Networks — LSTM 게이트 동작 최고 참고글</a>

<div class="cbox cbox-key">💡 <b>LSTM vs SimpleRNN</b><br>일반 RNN은 문장이 길어지면 앞부분 정보가 흐릿해지는 기울기 소실 문제가 있습니다. LSTM은 입력·망각·출력 세 개의 게이트로 어떤 정보를 기억하고 버릴지 스스로 제어합니다. 그래서 긴 문맥을 더 잘 기억합니다.</div>

<div class="cbox cbox-key">💡 <b>return_sequences=True</b><br>LSTM을 두 층으로 쌓을 때, 첫 번째 층에 써야 합니다. True이면 각 시점(각 단어)의 출력을 모두 다음 층으로 넘깁니다. False(기본값)이면 마지막 시점 출력 하나만 넘깁니다. 마지막 LSTM 층은 False로 둡니다.</div>

### Bidirectional — 양방향 LSTM

```python
Bidirectional(LSTM(units=64, return_sequences=True))
```

<div class="cbox cbox-key">💡 <b>Bidirectional(바이디렉셔널 — 양방향)</b><br>앞→뒤 방향과 뒤→앞 방향 두 가지로 읽어서 결과를 합칩니다. 예를 들어 "오늘 <b>날씨</b>가 맑다"에서 "날씨"는 앞의 "오늘"과 뒤의 "맑다" 양쪽 문맥을 모두 참고해야 더 잘 이해됩니다. 양방향으로 읽으면 문장 분류 성능이 올라갑니다.</div>

### Dropout / BatchNormalization

```python
from tensorflow.keras.layers import Dropout, BatchNormalization
Dropout(0.2)
BatchNormalization()
```

<div class="cbox cbox-key">💡 <b>Dropout(드롭아웃)(0.2)</b><br>학습 중 뉴런의 20%를 무작위로 끕니다. 특정 뉴런에 과하게 의존하는 현상을 막아 과적합을 줄입니다. 비유하자면, 시험 공부할 때 특정 사람에게만 의존하지 말고 혼자서도 풀 수 있도록 훈련하는 것과 같습니다. 예측(테스트)할 때는 드롭아웃이 자동으로 꺼져 모든 뉴런이 참여합니다.</div>

<div class="cbox cbox-key">💡 <b>BatchNormalization(배치 정규화)</b><br>층을 지나는 값의 분포가 들쭉날쭉해지는 현상을 잡아줍니다. 분포란 "숫자들이 얼마나 넓게 퍼져 있는가"입니다. 값들이 너무 크거나 너무 작으면 학습이 불안정해집니다. 배치 정규화는 값들을 평균 0, 분산 1 근처로 고르게 정돈해서 학습이 더 빠르고 안정적으로 진행되도록 합니다.</div>

---

## 12. 컴파일 — loss, optimizer, metrics

**컴파일(compile)**이란, 모델을 실제로 학습시키기 전에 "어떻게 학습할지"를 설정하는 단계입니다. 학습 방향(손실 함수), 학습 방법(옵티마이저), 평가 방법(지표)을 지정합니다.

```python
model.compile(
    loss='categorical_crossentropy',
    optimizer='adam',
    metrics=['accuracy']
)
```

| 파라미터 | 값 | 쉽게 말하면 |
|---|---|---|
| `loss` | `categorical_crossentropy` | **손실 함수(loss function)**란, "모델의 예측이 정답과 얼마나 틀렸는지"를 수치로 표현합니다. 이 숫자를 줄이는 방향으로 가중치가 조정됩니다. 다중 분류 + 원-핫 정답의 표준 조합입니다. 정수 라벨을 쓴다면 `sparse_categorical_crossentropy`를 씁니다 |
| `optimizer` | `adam` | **옵티마이저(optimizer)**는 손실을 줄이는 방향으로 가중치를 조정하는 알고리즘입니다. Adam(아담)은 학습률(한 번에 얼마나 크게 수정할지)을 상황에 맞게 자동으로 조정해서 별도 설정 없이도 빠르고 안정적으로 수렴합니다 |
| `metrics` | `['accuracy']` | 손실 수치는 직관적으로 와닿지 않습니다. **정확도(accuracy)**를 함께 출력해 "몇 %를 맞혔다"로 직접 확인할 수 있게 합니다 |

---

## 13. 조기 종료 — EarlyStopping

**과적합(overfitting)**이란, 모델이 학습 데이터를 너무 외워버려서 새로운 데이터에는 잘 맞추지 못하는 상태입니다. 학습을 너무 오래 하면 과적합이 심해집니다. **EarlyStopping(얼리스토핑 — 조기 종료)**은 더 학습해도 실제 성능이 좋아지지 않는 시점에 자동으로 멈추는 장치입니다.

```python
from tensorflow.keras.callbacks import EarlyStopping

early_stop = EarlyStopping(monitor='val_loss', patience=5)
```

<div class="cbox cbox-key">💡 <b>monitor='val_loss'</b><br>학습 손실(train loss)만 보면 학습을 오래 할수록 계속 줄어듭니다. 그런데 처음 보는 데이터에 대한 손실인 검증 손실(val_loss)이 오히려 올라가기 시작하면 과적합 신호입니다. 실제 일반화 능력을 보려면 검증 손실을 기준으로 멈춰야 합니다.</div>

<div class="cbox cbox-key">💡 <b>patience=5</b><br>검증 손실이 5번 연속으로 좋아지지 않으면 멈춥니다. patience=1이면 일시적인 변동에도 너무 민감하게 반응합니다. 5 정도 여유를 두면 진짜 포화 시점을 더 정확히 잡을 수 있습니다.</div>

<div class="cbox cbox-ex">📌 <b>구조 이유</b><br><code>epochs=100</code>으로 최대치를 크게 잡아두고, EarlyStopping이 적절한 시점에 알아서 멈추게 합니다. 실습에서는 18에폭 정도에서 조기 종료됩니다. 이는 정상적인 동작입니다.</div>

---

## 14. 학습 — `model.fit`

**에폭(epoch)**이란, 전체 학습 데이터를 한 바퀴 다 훑은 것을 1 에폭이라고 합니다. 에폭을 반복할수록 모델이 더 많이 학습됩니다.

**배치 크기(batch size)**란, 한 번에 몇 개의 데이터를 묶어서 학습할지입니다. 전체를 한꺼번에 넣으면 안정적이지만 느리고, 1개씩 넣으면(SGD — Stochastic Gradient Descent, 확률적 경사하강법) 빠르지만 불안정합니다. 64처럼 중간값을 씁니다.

```python
history = model.fit(
    X_train_sp, y_train,
    epochs=100,
    batch_size=64,
    callbacks=early_stop,
    validation_split=0.2
)
```

| 파라미터 | 값 | 쉽게 말하면 |
|---|---|---|
| `epochs` | 100 | EarlyStopping이 있어 실제로는 훨씬 일찍 멈춥니다. 학습 횟수의 상한선 역할입니다 |
| `batch_size` | 64 | 64개씩 묶어서 가중치를 업데이트합니다. 전체를 한꺼번에 쓰는 방식은 안정적이지만 느리고, 1개씩 쓰는 SGD는 잦지만 노이즈가 많습니다. 64는 중간 절충입니다 |
| `validation_split` | 0.2 | 학습 데이터의 20%를 매 에폭마다 검증에 씁니다. 이 값이 EarlyStopping의 val_loss에 활용됩니다 |

<div class="cbox cbox-ex">📌 <b>history 객체</b><br>에폭별 손실과 정확도가 기록됩니다. 나중에 학습 곡선을 그릴 때 이 객체를 사용합니다.</div>

---

## 15. 예측과 평가 — predict / argmax / evaluate

```python
y_pred    = model.predict(X_test_sp)
y_predict = np.argmax(y_pred, axis=1)
```

<div class="cbox cbox-def">💡 <b>predict의 출력</b><br>softmax 출력은 확률 배열입니다. 예: <code>[0.05, 0.82, 0.13]</code> → 2번째 클래스가 82% 확률. 이 배열에서 가장 큰 값의 위치(인덱스 번호)를 골라야 최종 분류 결과가 됩니다.</div>

<div class="cbox cbox-key">💡 <b>np.argmax(axis=1)</b><br><b>argmax</b>란, "가장 큰 값이 있는 위치(인덱스)"를 반환하는 함수입니다. <code>axis=1</code>은 "행(샘플) 단위로 찾아라"는 뜻입니다. 즉, 샘플마다 가장 높은 확률의 클래스 번호를 하나씩 뽑습니다. 정답도 원-핫 형태이므로 같은 방식으로 클래스 번호로 바꾼 뒤 비교합니다.</div>

```python
y_test_val = np.argmax(y_test.values, axis=1)
accuracy   = (y_test_val == y_predict).mean()   # True=1, False=0 평균 = 정확도

test_loss, test_acc = model.evaluate(X_test_sp, y_test)
```

---

## 16. 과적합 읽기

실습에서 학습 정확도 ≈ 0.96, 검증/테스트 정확도 ≈ 0.67이 나옵니다. 이 큰 격차가 **과적합(overfitting)**의 증거입니다.

쉽게 말하면, 학습 문제는 거의 다 맞히지만(96%) 새로운 문제는 많이 틀린(67%) 상태입니다. 모델이 학습 데이터를 통째로 외워버려서 처음 보는 데이터에 적응하지 못한 것입니다.

<figure class="nlp-fig">
<img src="https://upload.wikimedia.org/wikipedia/commons/f/f1/Overfitting_Example_with_Generalization.png" alt="2차(일반화) vs 5차(과적합) 곡선 비교 — 고차 곡선은 학습 데이터에 과도하게 맞춰져 새 데이터에서 오류가 큼" loading="lazy">
<figcaption>이 그림은 과적합과 일반화의 차이를 보여줍니다. 여기서 핵심은, 같은 파란 점(학습 데이터)을 통과하는 곡선이 두 가지라는 것입니다. 매끈한 곡선(일반화)은 데이터의 전체적인 흐름을 잡아 새 데이터에도 잘 맞습니다. 구불구불한 곡선(과적합)은 학습 데이터의 점 하나하나를 모두 통과하려다 보니 쓸데없이 복잡해졌고, 학습 데이터 범위를 벗어나면 크게 틀립니다. 우리 실습의 "학습 96% vs 테스트 67%"가 바로 이 상황입니다. <small>(Wikimedia, CC BY-SA 4.0)</small></figcaption>
</figure>

<a class="explore" href="https://mlu-explain.github.io/bias-variance/" target="_blank" rel="noopener">🔗 편향-분산 인터랙티브 — 과적합·과소적합 트레이드오프 체험</a>

<a class="explore" href="https://playground.tensorflow.org/" target="_blank" rel="noopener">🔗 TF Playground — 정규화·드롭아웃 조절로 과적합 직접 체험</a>

<div class="cbox cbox-key">💡 <b>개선 포인트</b><br>① 드롭아웃 비율 높이기 (0.2 → 0.4~0.5): 더 많은 뉴런을 꺼서 외우기를 방지<br>② 모델 복잡도 줄이기 (층 수 또는 units 감소): 단순한 모델은 덜 외움<br>③ 학습 데이터 늘리기: 더 많은 예시를 보면 패턴을 더 잘 일반화<br>④ vocab_size · max_length 조정: 입력 특징의 양 조절<br>⑤ 사전학습 임베딩 활용 — Word2Vec(워드투벡, 단어를 의미 벡터로 변환하는 대표 모델)이나 FastText(패스트텍스트, Word2Vec을 개선해 단어 내 세부 구조까지 학습하는 모델)처럼, 이미 대량의 텍스트로 학습된 벡터를 가져다 쓰는 방법입니다. 처음부터 배우는 것보다 훨씬 좋은 출발점을 제공합니다<br>⑥ 클래스 불균형 처리 강화: 드문 분류도 충분히 학습하도록 조정</div>

---

## 코드 흐름 한눈에

```
데이터 로드(read_csv)
  → 결측치 제거(dropna) → 문서 결합(+)
  → 레이블 인코딩(get_dummies) → 데이터 분리(train_test_split)

[LDA 경로]
  → CountVectorizer(fit_transform) → LDA(fit) → pyLDAvis

[유사도 경로]
  → TfidfVectorizer(fit_transform) → cosine_similarity

[딥러닝 경로]
  → Tokenizer(fit_on_texts) → texts_to_sequences → pad_sequences
  → Embedding → Bidirectional(LSTM) → Dropout/BatchNorm → Dense(softmax)
  → compile(categorical_crossentropy / adam / accuracy)
  → EarlyStopping → fit(epochs / batch_size / validation_split)
  → predict → argmax → evaluate
```

<div class="cbox cbox-warn">⚠️ <b>핵심 시험 포인트</b><br>코드를 외우는 게 아니라, <b>"이 줄이 왜 여기 있는가"</b>를 설명하는 것이 이 과목의 핵심입니다. 각 단계의 순서와 이유를 자기 말로 설명할 수 있으면 서술형 문제 대부분에 대응할 수 있습니다.</div>
