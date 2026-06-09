---
deck_id: nlp3_exam_72
subject_id: nlp
title: 3) 기말 답안·실전 — 7.2 RNN·딥러닝
unit: nlp-exam-72
area: written
subarea: database
schema_version: 1
---

## @nlp-ex72-q01
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
```
딥러닝 분류인데도 numpy·pandas·matplotlib·seaborn을 먼저 불러오는 이유는?
---BACK---
모델 학습 전후로 데이터를 표로 다루고(pandas), 배열 연산을 하고(numpy), 학습 곡선·분포를 시각화(matplotlib·seaborn)해야 하기 때문이다. 딥러닝도 데이터 전처리와 결과 분석은 동일한 기본 도구를 쓴다.

**핵심키워드**: 데이터 처리, 배열 연산, 학습 곡선 시각화

---

## @nlp-ex72-q02
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
df = pd.read_csv("https://bit.ly/seoul-120-text-csv")
df.shape
```
7.1과 같은 데이터를 쓰는데, 분석 목적(LDA vs RNN 분류)이 다르다. 데이터는 같아도 무엇이 달라지는가?
---BACK---
7.1은 정답 없이 토픽을 찾는 비지도였고, 7.2는 "분류" 정답을 맞히는 지도학습이다. 같은 텍스트라도 7.2에서는 분류 컬럼을 정답(y)으로 쓰고, 모델이 텍스트→카테고리 관계를 학습한다.

**핵심키워드**: 동일 데이터/다른 목적, 지도학습, 정답 사용

---

## @nlp-ex72-q03
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
df["문서"] = df["제목"] + df["내용"]
```
제목과 내용을 합쳐 "문서" 파생변수를 만드는 이유를 설명하라. (7.1과 달리 공백 없이 붙인 점도 언급)
---BACK---
제목과 내용의 단어를 한 입력으로 합쳐 분류에 쓸 정보를 풍부하게 하기 위함이다. 다만 여기선 공백 없이 붙여, 제목 끝 단어와 내용 첫 단어가 한 토큰으로 붙을 수 있다 — 공백을 넣는 7.1 방식이 토큰 경계 측면에서 더 안전하다.

**핵심키워드**: 텍스트 결합, 파생변수, 공백 유무·토큰 경계

---

## @nlp-ex72-q04
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
```python
df["분류"].value_counts()
```
분류별 빈도를 확인하는 이유는?
---BACK---
클래스(카테고리)별 데이터 개수가 균형 잡혀 있는지 보기 위해서다. 한 클래스가 너무 많거나 적으면(불균형) 모델이 다수 클래스에 쏠려 학습되므로, 그에 대한 대응을 미리 결정해야 한다.

**핵심키워드**: 클래스 분포, 불균형 점검, 학습 편향

---

## @nlp-ex72-q05
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
df = df[df["분류"].isin(["행정", "경제", "복지"])]
```
전체 10개 분류 중 상위 3개("행정","경제","복지")만 추출한 이유를 설명하라.
---BACK---
데이터가 적은 클래스(예: 여성가족 13건)는 학습에 충분치 않아 불균형이 심하다. 그대로 전부 쓰면 소수 클래스를 거의 못 맞혀 성능이 떨어진다. 데이터가 충분한 상위 클래스만 남겨 불균형을 완화하고 학습을 안정시키려는 것이다.

**핵심키워드**: 클래스 불균형 완화, 데이터 충분성, 베이스라인 단순화

---

## @nlp-ex72-q06
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
클래스 수를 줄이면 분류 문제 자체는 어떻게 쉬워지는가?
---BACK---
맞혀야 할 후보가 10개에서 3개로 줄어 무작위로 찍어도 맞을 확률이 올라가고, 클래스 간 경계 학습이 단순해진다. 베이스라인 모델의 성능을 안정적으로 확보하기 위한 선택이다.

**핵심키워드**: 후보 수 감소, 문제 단순화, 베이스라인

---

## @nlp-ex72-q07
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
label_name = "분류"
X = df["문서"]
y = df[label_name]
```
독립변수 X와 종속변수 y로 나누는 이유, 그리고 각각이 무엇인지 설명하라.
---BACK---
X는 모델에 넣을 입력(문제=문서 텍스트), y는 맞혀야 할 정답(분류)이다. 머신러닝은 입력과 정답의 관계를 학습하므로 둘을 명확히 분리해야 한다. label_name을 변수로 둔 건 정답 컬럼을 바꿔도 코드 수정이 쉽게 하기 위함이다.

**핵심키워드**: 입력/정답 분리, X=문서/y=분류, 변수화

---

## @nlp-ex72-q08
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
```python
y_onehot = pd.get_dummies(y)
```
정답을 원-핫(one-hot) 형태로 바꾸는 이유를 설명하라.
---BACK---
분류 같은 범주형 정답은 숫자 크기에 순서·대소 의미가 없어야 하는데, 그냥 0/1/2로 두면 모델이 크기 관계로 오해할 수 있다. 원-핫은 각 클래스를 독립된 열로 표현해(예: 행정=[0,0,1]) 클래스 간 동등성을 유지한다.

**핵심키워드**: 범주형 정답, 원-핫, 클래스 동등성, softmax 대응

---

## @nlp-ex72-q09
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
원-핫 인코딩과 라벨 인코딩(0,1,2…)의 차이는?
---BACK---
라벨 인코딩은 클래스를 하나의 정수로 매기지만 그 숫자에 순서 의미가 생긴다. 원-핫은 클래스 수만큼 열을 만들어 해당 위치만 1로 두므로 순서 오해가 없다. 출력층이 softmax+categorical_crossentropy면 원-핫이 짝이 맞는다.

**핵심키워드**: 정수 라벨 vs 원-핫, 순서 의미, 손실함수 짝

---

## @nlp-ex72-q10
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
```python
X_train, X_test, y_train, y_test = train_test_split(
    X, y_onehot, test_size=0.2, random_state=42, stratify=y_onehot)
```
학습 데이터와 시험(테스트) 데이터를 나누는 이유를 설명하라.
---BACK---
모델이 처음 보는 데이터에서도 잘 작동하는지(일반화) 평가하려면, 학습에 쓰지 않은 데이터로 따로 시험해야 한다. 같은 데이터로 학습·평가하면 외운 것을 다시 맞히는 셈이라 성능이 부풀려진다.

**핵심키워드**: 일반화 평가, 학습/평가 분리, 과적합 방지

---

## @nlp-ex72-q11
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
`test_size=0.2`의 의미와, 비율을 더 키우거나 줄였을 때의 영향은?
---BACK---
전체의 20%를 테스트용으로 떼어둔다는 뜻이다. 테스트 비율을 키우면 평가는 안정되지만 학습 데이터가 줄어 모델 성능이 떨어질 수 있고, 줄이면 학습은 많아지나 평가가 불안정해진다. 보통 0.2~0.3을 쓴다.

**핵심키워드**: 0.2(20%), 학습량 vs 평가 안정성 트레이드오프

---

## @nlp-ex72-q12
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
`random_state=42`를 지정하는 이유는?
---BACK---
데이터를 무작위로 섞어 나누므로, 시드를 고정해야 매번 같은 분할이 나와 결과를 재현할 수 있다. 42라는 값 자체에 의미는 없고 고정만 되면 된다.

**핵심키워드**: 시드 고정, 동일 분할 재현, 값 무의미

---

## @nlp-ex72-q13
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
`stratify=y_onehot`을 설정한 이유를 설명하라.
---BACK---
분할할 때 각 클래스 비율을 학습·테스트에 동일하게 유지(계층적 샘플링)하기 위함이다. 불균형 데이터에서 이걸 안 하면 한쪽에 특정 클래스가 몰려 평가가 왜곡되는데, stratify로 원래 분포를 보존한다.

**핵심키워드**: 계층적 샘플링, 클래스 비율 유지, 불균형 대응

---

## @nlp-ex72-q14
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
```python
display(y_train.mean())
display(y_test.mean())
```
학습/테스트의 클래스 평균(비율)을 비교해 보는 이유는?
---BACK---
stratify가 잘 적용되어 두 집합의 클래스 비율이 거의 같은지 확인하기 위해서다. 비율이 비슷해야 테스트가 학습과 같은 분포를 대표해 평가가 공정하다.

**핵심키워드**: 분포 일치 확인, stratify 검증, 공정한 평가

---

## @nlp-ex72-q15
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
케라스 Tokenizer가 하는 일(정수 인코딩)을 설명하라.
---BACK---
텍스트의 모든 단어를 빈도순으로 정렬해 각 단어에 정수 인덱스를 부여하고, 문장을 그 정수들의 나열로 바꾼다. 신경망은 문자열을 직접 못 다루므로 단어를 숫자로 변환해 입력 가능하게 만드는 단계다.

**핵심키워드**: 정수 인코딩, 단어→인덱스, 빈도순, 신경망 입력화

---

## @nlp-ex72-q16
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
vocab_size = 1000
tokenizer = Tokenizer(num_words=vocab_size, oov_token="<oov>")
```
`num_words=1000`(vocab_size)의 의미와, 값을 키우거나 줄였을 때의 장단점은?
---BACK---
빈도 상위 약 1000개 단어만 사용하고 나머지는 버린다는 뜻이다. 크게 잡으면 더 많은 단어를 살려 표현력이 늘지만 차원·파라미터가 커지고 드문 단어 노이즈가 늘며 학습이 무거워진다. 작게 잡으면 가볍지만 중요한 단어를 놓칠 수 있다.

**핵심키워드**: 어휘 크기, 빈도 상위 단어, 표현력 vs 비용

---

## @nlp-ex72-q17
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
`oov_token="<oov>"`은 무엇을 위한 설정인가?
---BACK---
어휘 사전에 없는(Out-Of-Vocabulary) 단어를 만났을 때 버리지 않고 `<oov>`라는 특수 토큰으로 대체한다. 미등록 단어가 있던 자리를 표시해 문장 구조를 유지하고, 정보 손실을 줄인다.

**핵심키워드**: OOV(미등록어), 특수 토큰 대체, 정보 보존

---

## @nlp-ex72-q18
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
```python
tokenizer.fit_on_texts(X_train)
```
`fit_on_texts`를 학습 데이터(X_train)에만 적용하는 이유는?
---BACK---
단어 사전은 학습 데이터에서만 만들어야 한다. 테스트 데이터까지 사전 학습에 쓰면 모델이 시험 정보를 미리 본 셈(데이터 누수)이 되어 평가가 부풀려진다. 그래서 fit은 train에만 한다.

**핵심키워드**: 어휘 사전 학습, train 전용 fit, 데이터 누수 방지

---

## @nlp-ex72-q19
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
```python
word_to_index = tokenizer.word_index
```
`word_index`는 무엇을 담고 있는가?
---BACK---
각 단어와 그에 매겨진 정수 인덱스의 짝(딕셔너리)을 담는다. 이 사전을 통해 문장이 어떤 숫자열로 바뀌는지, 인덱스가 어떤 단어인지 확인할 수 있다.

**핵심키워드**: 단어-인덱스 사전, 매핑 확인

---

## @nlp-ex72-q20
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
```python
list(tokenizer.word_counts.items())[:5]
```
단어별 빈도(`word_counts`)를 확인하는 이유는?
---BACK---
어떤 단어가 많이/적게 나오는지 분포를 파악해, vocab_size를 얼마로 둘지나 불용어 처리를 어떻게 할지 판단하는 근거로 삼기 위함이다.

**핵심키워드**: 단어 빈도 분포, vocab_size 결정 근거

---

## @nlp-ex72-q21
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
Tokenizer가 자동으로 소문자 변환·구두점 제거를 하는데, 이것이 분석에 주는 이점은?
---BACK---
"Apple"과 "apple"을 같은 단어로 통일하고, 의미 없는 마침표·느낌표를 제거해 불필요하게 단어가 쪼개지는 것을 막는다. 같은 단어를 하나로 모아 사전 크기를 줄이고 표현을 일관되게 한다.

**핵심키워드**: 소문자 통일, 구두점 제거, 중복 토큰 방지

---

## @nlp-ex72-q22
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
train_sequences = tokenizer.texts_to_sequences(X_train)
test_sequences = tokenizer.texts_to_sequences(X_test)
```
`texts_to_sequences`의 역할과, train·test에 모두 적용하되 fit은 train만 한 이유를 설명하라.
---BACK---
texts_to_sequences는 문장을 사전 인덱스의 정수 리스트로 변환한다. 변환은 train·test 모두 필요하지만, 사전(fit)은 train에서만 만들어 그 동일한 사전으로 test도 변환한다 — 그래야 데이터 누수 없이 일관된 기준으로 인코딩된다.

**핵심키워드**: 문장→정수열 변환, 동일 사전 적용, 누수 방지

---

## @nlp-ex72-q23
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
패딩(padding)이 왜 필요한지 설명하라.
---BACK---
문장마다 단어 수가 달라 정수열 길이가 제각각인데, 신경망은 입력 크기가 일정해야 한다. 짧은 문장 뒤(또는 앞)를 0으로 채워 모든 입력 길이를 똑같이 맞추기 위해 패딩을 한다.

**핵심키워드**: 가변 길이→고정 길이, 0 채우기, 입력 형태 통일

---

## @nlp-ex72-q24
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
max_length = 500
X_train_sp = pad_sequences(train_sequences, padding=padding_type, maxlen=max_length)
```
`max_length=500`의 의미와, 너무 크게/작게 잡았을 때의 문제는?
---BACK---
모든 문장의 길이를 500으로 통일한다는 뜻으로, 길면 자르고 짧으면 0으로 채운다. 너무 크게 잡으면 0이 과도하게 들어가 계산이 무겁고 비효율적이며, 너무 작게 잡으면 긴 문서의 뒷부분 정보가 잘려 손실된다.

**핵심키워드**: 시퀀스 길이 통일, 자르기/채우기, 정보 손실 vs 계산 비용

---

## @nlp-ex72-q25
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
padding_type = "post"   # vs "pre"
```
`padding="post"`와 `"pre"`의 차이를 설명하라.
---BACK---
post는 문장 뒤쪽을 0으로 채우고, pre는 앞쪽을 채운다. RNN 계열은 뒤쪽 정보가 최종 상태에 더 크게 반영되는 경향이 있어, 0을 앞에 두는 pre가 유리하다는 견해도 있다. 어디를 채우느냐에 따라 모델이 받는 정보 위치가 달라진다.

**핵심키워드**: 뒤 채움(post)/앞 채움(pre), RNN 최종상태 영향

---

## @nlp-ex72-q26
- type: judge
- grade_mode: self
- weight: 9

---FRONT---
```python
embedding_dim = 64
Embedding(input_dim=vocab_size, output_dim=embedding_dim, input_length=max_length)
```
임베딩(Embedding) 층이 무엇이며 왜 필요한지 설명하라.
---BACK---
단어 정수 인덱스를 의미를 담은 실수 벡터로 바꿔주는 층이다. 정수 자체에는 단어 간 의미 관계가 없지만, 임베딩은 비슷한 단어가 비슷한 벡터를 갖도록 학습해 단어의 의미를 수치로 표현한다. 원-핫보다 차원이 작고 밀집된 표현을 준다.

**핵심키워드**: 단어→밀집 벡터, 의미 표현, 원-핫 대비 저차원

---

## @nlp-ex72-q27
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
`input_dim=vocab_size`, `output_dim=embedding_dim`, `input_length=max_length`가 각각 무엇을 의미하는가?
---BACK---
input_dim은 사전에 든 단어 수(임베딩 행 수), output_dim은 각 단어를 표현할 벡터의 차원(여기선 64), input_length는 한 문장의 길이(패딩으로 맞춘 500)다. 즉 1000개 단어를 각각 64차원 벡터로, 길이 500 문장에 대해 매핑한다.

**핵심키워드**: 어휘 수/임베딩 차원/문장 길이

---

## @nlp-ex72-q28
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
`embedding_dim=64`처럼 임베딩 차원을 키우거나 줄였을 때의 영향은?
---BACK---
차원을 키우면 단어의 미세한 의미 차이를 더 담을 수 있지만 파라미터가 늘어 학습이 무겁고 과적합 위험이 커진다. 줄이면 가볍지만 표현력이 떨어진다. 데이터 양에 맞춰 적정 차원을 고른다.

**핵심키워드**: 표현력 vs 파라미터 수, 과적합

---

## @nlp-ex72-q29
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
n_class = y_train.shape[1]
```
`n_class`를 `y_train.shape[1]`로 구하는 이유는?
---BACK---
정답이 원-핫이라 열 개수가 곧 클래스 수다(여기선 3). 출력층 뉴런 수를 클래스 수에 맞춰야 하므로, 하드코딩 대신 데이터에서 자동으로 가져와 유연하게 만든 것이다.

**핵심키워드**: 원-핫 열 수=클래스 수, 출력층 크기, 자동 계산

---

## @nlp-ex72-q30
- type: judge
- grade_mode: self
- weight: 9

---FRONT---
SimpleRNN, LSTM, GRU의 차이를 간단히 설명하라.
---BACK---
셋 다 순서가 있는 데이터를 처리하는 순환 신경망이다. SimpleRNN은 구조가 단순하지만 긴 문장에서 앞쪽 정보를 잊는(기울기 소실) 문제가 있고, LSTM은 게이트와 셀 상태로 장기 기억을 보완했다. GRU는 LSTM을 더 간소화해 비슷한 성능을 더 가볍게 낸다.

**핵심키워드**: 순환 신경망, 기울기 소실, LSTM 게이트, GRU 경량화

---

## @nlp-ex72-q31
- type: judge
- grade_mode: self
- weight: 9

---FRONT---
SimpleRNN 대신 LSTM을 쓰는 이유(기울기 소실 관점)를 설명하라.
---BACK---
SimpleRNN은 문장이 길어지면 앞부분 정보가 점점 희미해져(기울기 소실) 장기 의존성을 학습하기 어렵다. LSTM은 정보를 오래 유지·삭제하는 게이트 구조가 있어 긴 문맥을 더 잘 기억한다.

**핵심키워드**: 장기 의존성, 기울기 소실 완화, 게이트/셀 상태

---

## @nlp-ex72-q32
- type: judge
- grade_mode: self
- weight: 9

---FRONT---
```python
Bidirectional(LSTM(units=64, return_sequences=True))
```
`Bidirectional`(양방향)으로 감싸는 이유를 설명하라.
---BACK---
일반 RNN은 앞→뒤 한 방향으로만 읽지만, 양방향은 뒤→앞도 함께 읽어 한 단어를 앞뒤 문맥 모두로 이해한다. 문장 전체 맥락이 중요한 분류에서 더 풍부한 정보를 잡아 성능이 올라가는 경우가 많다.

**핵심키워드**: 양방향 문맥, 앞뒤 정보 결합, 문맥 이해 강화

---

## @nlp-ex72-q33
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
첫 번째 LSTM에 `return_sequences=True`를 준 이유는?
---BACK---
LSTM을 두 층 쌓을 때, 첫 층이 각 시점의 출력(시퀀스 전체)을 다음 LSTM에 넘겨줘야 하기 때문이다. True면 모든 시점의 출력을, False(기본)면 마지막 출력만 반환한다. 그래서 마지막 LSTM에는 이 옵션이 없다.

**핵심키워드**: 시퀀스 출력 전달, LSTM 적층, 마지막만 vs 전체

---

## @nlp-ex72-q34
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
BatchNormalization()
```
배치 정규화(BatchNormalization)의 역할을 설명하라.
---BACK---
층을 지나는 값들의 분포를 정규화해 학습을 안정시키고 속도를 높인다. 값이 들쭉날쭉해 학습이 흔들리는 것을 줄여, 더 빠르고 안정적으로 수렴하도록 돕는다.

**핵심키워드**: 분포 정규화, 학습 안정화·가속, 수렴 개선

---

## @nlp-ex72-q35
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
```python
Dropout(0.2)
```
드롭아웃(Dropout 0.2)이 무엇이며 왜 쓰는가?
---BACK---
학습 중 무작위로 일부(20%) 뉴런을 꺼서 특정 뉴런에 과도하게 의존하지 못하게 한다. 모델이 학습 데이터를 통째로 외우는 과적합을 줄이고 일반화 성능을 높이는 규제 기법이다.

**핵심키워드**: 무작위 뉴런 비활성, 과적합 방지, 규제(regularization)

---

## @nlp-ex72-q36
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
Dense(units=16, activation='relu')
```
은닉 Dense 층에 `relu` 활성화 함수를 쓰는 이유는?
---BACK---
ReLU는 음수는 0, 양수는 그대로 통과시키는 단순한 함수로 계산이 빠르고, 기울기 소실이 덜해 깊은 신경망 학습에 잘 맞는다. 비선형성을 더해 복잡한 패턴을 학습하게 한다.

**핵심키워드**: 비선형성, 기울기 소실 완화, 계산 효율

---

## @nlp-ex72-q37
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
```python
Dense(units=n_class, activation='softmax')
```
출력층 뉴런 수를 `n_class`로, 활성화를 `softmax`로 둔 이유를 설명하라.
---BACK---
클래스가 3개라 출력 뉴런도 3개여야 각 클래스 확률을 낼 수 있다. softmax는 출력들을 합이 1인 확률 분포로 바꿔, 여러 클래스 중 하나를 고르는 다중분류에 적합하다.

**핵심키워드**: 출력=클래스 수, softmax(합=1 확률), 다중분류

---

## @nlp-ex72-q38
- type: judge
- grade_mode: self
- weight: 9

---FRONT---
```python
model.compile(loss='categorical_crossentropy', optimizer='adam', metrics=['accuracy'])
```
손실 함수로 `categorical_crossentropy`를 쓴 이유와, `sparse_categorical_crossentropy`와의 차이를 설명하라.
---BACK---
여러 클래스 중 하나를 맞히는 다중분류이고 정답이 원-핫 형태라 categorical_crossentropy가 짝이 맞는다. 정답이 정수 라벨(0,1,2)이면 sparse_ 버전을 쓴다. 즉 정답 인코딩 형식에 맞춰 고른다.

**핵심키워드**: 다중분류 손실, 원-핫↔categorical, 정수↔sparse

---

## @nlp-ex72-q39
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
옵티마이저로 `adam`을 선택한 이유는?
---BACK---
Adam은 학습률을 상황에 맞게 자동 조정해주는 옵티마이저로, 따로 세밀하게 튜닝하지 않아도 대체로 빠르고 안정적으로 수렴한다. 그래서 기본 선택으로 널리 쓰인다.

**핵심키워드**: 적응적 학습률, 빠른 수렴, 범용 기본값

---

## @nlp-ex72-q40
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
`metrics=['accuracy']`로 정확도를 지표로 본 이유는?
---BACK---
분류 문제에서 가장 직관적인 성능 지표가 "맞힌 비율(정확도)"이기 때문이다. 학습 중 모델이 얼마나 정답을 맞히는지 사람이 바로 이해할 수 있게 한다.

**핵심키워드**: 분류 지표, 맞힌 비율, 해석 용이

---

## @nlp-ex72-q41
- type: judge
- grade_mode: self
- weight: 6

---FRONT---
```python
model.summary()
```
`summary()`로 파라미터 수를 확인하는 이유는?
---BACK---
모델 구조와 층별 출력 크기, 학습할 파라미터 수를 점검하기 위해서다. 파라미터가 너무 많으면 과적합·과부하 위험을 미리 가늠할 수 있다.

**핵심키워드**: 모델 구조 점검, 파라미터 규모, 과적합 가늠

---

## @nlp-ex72-q42
- type: judge
- grade_mode: self
- weight: 9

---FRONT---
```python
early_stop = EarlyStopping(monitor='val_loss', patience=5)
```
조기 종료(EarlyStopping)를 `val_loss` 기준, `patience=5`로 설정한 이유를 설명하라.
---BACK---
검증 손실(val_loss)이 더 이상 줄지 않으면 학습을 멈춰 과적합을 막고 시간을 아낀다. patience=5는 5에폭 동안 개선이 없으면 중단한다는 뜻으로, 일시적 변동에 바로 멈추지 않도록 여유를 둔 것이다.

**핵심키워드**: 과적합 방지, 검증 손실 모니터, patience(인내 에폭)

---

## @nlp-ex72-q43
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
```python
history = model.fit(X_train_sp, y_train, epochs=100, batch_size=64,
                    callbacks=early_stop, validation_split=0.2)
```
`epochs=100`인데 실제로는 18에폭에서 멈췄다. 이유를 설명하라.
---BACK---
epochs=100은 최대 반복 횟수일 뿐이고, EarlyStopping이 검증 손실 개선이 멈추자 그 전에 학습을 중단시켰기 때문이다. 즉 최대치를 크게 두고 조기 종료가 적절한 시점을 알아서 잡게 한 구조다.

**핵심키워드**: 최대 에폭, 조기 종료 작동, 자동 중단

---

## @nlp-ex72-q44
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
`batch_size=64`의 의미와, 크게/작게 했을 때의 영향은?
---BACK---
한 번에 64개 샘플씩 묶어 가중치를 갱신한다는 뜻이다. 크게 하면 학습이 안정적이고 빠르지만 메모리를 많이 쓰고 일반화가 떨어질 수 있으며, 작게 하면 갱신이 잦아 노이즈가 많지만 일반화에 도움이 되기도 한다.

**핵심키워드**: 배치 크기, 메모리·속도 vs 일반화

---

## @nlp-ex72-q45
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
`validation_split=0.2`를 둔 이유는?
---BACK---
학습 데이터의 20%를 검증용으로 떼어, 매 에폭마다 학습에 안 쓴 데이터로 성능을 확인하기 위함이다. 이 검증 손실로 과적합 여부를 보고 EarlyStopping의 기준으로도 쓴다.

**핵심키워드**: 검증 세트, 에폭별 점검, 조기 종료 기준

---

## @nlp-ex72-q46
- type: judge
- grade_mode: self
- weight: 8

---FRONT---
```python
y_pred = model.predict(X_test_sp)
y_predict = np.argmax(y_pred, axis=1)
```
예측 결과에 `np.argmax(axis=1)`를 적용하는 이유를 설명하라.
---BACK---
softmax 출력은 클래스별 확률 배열이라, 가장 확률이 큰 클래스를 최종 답으로 골라야 한다. argmax는 행마다 가장 큰 값의 위치(클래스 인덱스)를 돌려주어 확률을 실제 분류 결과로 바꾼다.

**핵심키워드**: 확률→클래스 변환, 최댓값 인덱스, axis=1(행 방향)

---

## @nlp-ex72-q47
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
y_test_val = np.argmax(y_test.values, axis=1)
(y_test_val == y_predict).mean()
```
실제값과 예측값을 비교해 평균을 구하면 무엇이 나오는가?
---BACK---
원-핫 정답도 argmax로 클래스 인덱스로 바꾼 뒤, 예측과 같은지(True/False) 비교해 평균을 내면 맞힌 비율, 즉 정확도가 된다. True=1, False=0이라 평균이 곧 정답률이다.

**핵심키워드**: 정확도 계산, True/False 평균, 정답률

---

## @nlp-ex72-q48
- type: judge
- grade_mode: self
- weight: 7

---FRONT---
```python
test_loss, test_acc = model.evaluate(X_test_sp, y_test)
```
`evaluate`로 다시 평가하는 것과 앞의 정확도 계산은 무엇이 다른가?
---BACK---
evaluate는 컴파일 때 지정한 손실과 지표(정확도)를 한 번에 계산해 돌려준다. 앞서 직접 argmax로 구한 정확도와 evaluate의 정확도가 일치하는지 교차 확인하는 의미도 있다.

**핵심키워드**: 손실+지표 동시 산출, 교차 확인

---

## @nlp-ex72-q49
- type: judge
- grade_mode: self
- weight: 10

---FRONT---
학습 정확도는 약 0.96인데 검증/테스트 정확도는 약 0.67이다. 이 현상을 진단하고 개선 방안을 본인의 생각으로 기술하라. *(핵심 출제 예상)*
---BACK---
학습 성능은 높은데 검증 성능이 크게 낮은 것은 **과적합**이다. 모델이 학습 데이터를 외워버려 새 데이터에 일반화하지 못한 상태다. 개선책으로는 드롭아웃·규제를 강화하고 모델을 단순화하거나, 데이터를 늘리고 클래스 불균형을 처리하며, 사전학습된 임베딩을 쓰거나 vocab_size·max_length를 조정해볼 수 있다.

**핵심키워드**: 과적합 진단, 일반화 실패, 드롭아웃 강화·데이터 증강·모델 단순화

---

## @nlp-ex72-q50
- type: judge
- grade_mode: self
- weight: 9

---FRONT---
같은 코드로 데이터셋만 바꿨을 때 성능을 높이려면 어떤 점들을 손보겠는가? 종합적으로 기술하라.
---BACK---
한국어 형태소 분석으로 토큰을 정제하고, vocab_size·max_length를 데이터 특성에 맞게 조정한다. 클래스 불균형은 stratify·일부 클래스 추출·가중치로 다루고, 과적합은 드롭아웃·EarlyStopping·배치정규화로 억제한다. 모델 측면에선 LSTM/GRU·양방향·층 수·임베딩 차원을 실험하고, 가능하면 사전학습 임베딩을 활용한다.

**핵심키워드**: 형태소 분석, 하이퍼파라미터 튜닝, 불균형 처리, 과적합 억제, 모델 구조 실험

---

## @nlp-ex72-term-01
- type: func
- grade_mode: exact
- weight: 9
- answers: 과적합 | overfitting | 오버피팅

---FRONT---
학습 데이터에서 정확도는 높은데 검증/테스트 데이터에서 크게 낮아지는 현상 — 모델이 학습 데이터를 '외워버린' 상태를 무엇이라 하는가?
---BACK---
**과적합(Overfitting)**

- 진단 기준: train 정확도 ≫ validation 정확도 (큰 격차)
- 원인: 모델 복잡도가 데이터 대비 과도하거나 학습 데이터가 부족할 때
- 대응: 드롭아웃, 규제(L1/L2), 모델 단순화, 데이터 증강, EarlyStopping

---

## @nlp-ex72-term-02
- type: cloze
- weight: 9

---FRONT---
케라스 Tokenizer에서 어휘 사전에 없는 단어를 처리하기 위해 지정하는 특수 토큰 파라미터는 {{oov_token}}이며, 이를 설정하지 않으면 해당 단어는 {{삭제|제거|빠짐}}된다.
---BACK---
- **oov_token**: Out-Of-Vocabulary 단어를 지정된 토큰(예: `<oov>`)으로 대체
- 미설정 시: 사전에 없는 단어는 정수열에서 아예 빠짐 → 문장 구조 손실
- 설정 시: 자리를 유지하므로 시퀀스 길이 및 문맥 구조 보존에 유리

---

## @nlp-ex72-term-03
- type: func
- grade_mode: exact
- weight: 9
- answers: LSTM | Long Short-Term Memory

---FRONT---
기울기 소실 문제를 해결하기 위해 게이트(입력/망각/출력 게이트)와 셀 상태를 도입한 순환 신경망 구조는?
---BACK---
**LSTM (Long Short-Term Memory)**

- 망각 게이트: 이전 기억 중 버릴 것을 결정
- 입력 게이트: 새 정보를 얼마나 기억에 반영할지 결정
- 출력 게이트: 현재 셀 상태에서 얼마를 다음 층에 출력할지 결정
- SimpleRNN 대비 긴 문맥 의존성 학습에 유리

---

## @nlp-ex72-term-04
- type: cloze
- weight: 8

---FRONT---
패딩에서 `padding="post"`는 문장 {{뒤쪽}}에 0을 채우고, `padding="pre"`는 문장 {{앞쪽}}에 0을 채운다.
---BACK---
- **post(뒤 채움)**: 문장 끝에 0 추가 → RNN이 실제 단어를 먼저 처리 후 0을 처리
- **pre(앞 채움)**: 문장 앞에 0 추가 → 실제 단어가 뒤쪽에 위치해 RNN 최종 상태에 더 가까이 반영됨
- 어느 쪽이 좋은지는 데이터·모델 구조에 따라 다름

---

## @nlp-ex72-term-05
- type: func
- grade_mode: exact
- weight: 8
- answers: softmax

---FRONT---
다중분류 출력층에서 각 클래스의 출력값을 합이 1이 되는 확률 분포로 변환하는 활성화 함수는?
---BACK---
**softmax**

- 출력값들을 지수 함수로 변환 후 합으로 나눠 확률화
- 각 출력 = 해당 클래스일 확률 (0~1, 전체 합 = 1)
- categorical_crossentropy 손실 함수와 짝을 이룸

---

## @nlp-ex72-term-06
- type: cloze
- weight: 8

---FRONT---
`model.compile(loss='{{categorical_crossentropy}}', optimizer='adam', metrics=['accuracy'])`에서, 정답이 원-핫 인코딩이 아닌 정수 라벨(0, 1, 2)일 경우에는 `{{sparse_categorical_crossentropy}}`를 사용해야 한다.
---BACK---
- **categorical_crossentropy**: 정답이 원-핫(예: [0, 0, 1]) 형태일 때 사용
- **sparse_categorical_crossentropy**: 정답이 정수 인덱스(예: 2) 형태일 때 사용
- 두 손실의 수학적 계산 결과는 동일하며, 입력 형식만 다름

---

## @nlp-ex72-term-07
- type: func
- grade_mode: exact
- weight: 8
- answers: EarlyStopping | 조기 종료

---FRONT---
검증 손실(val_loss)이 일정 에폭 동안 개선되지 않으면 학습을 자동으로 중단시켜 과적합과 불필요한 학습 시간을 막는 콜백은?
---BACK---
**EarlyStopping**

- `monitor`: 감시할 지표 (보통 `val_loss`)
- `patience`: 개선 없이 기다릴 에폭 수 (예: 5)
- `restore_best_weights=True`: 최적 가중치 복원 옵션 (선택)
- 효과: 과적합 방지 + 학습 시간 절약

---

## @nlp-ex72-term-08
- type: cloze
- weight: 9

---FRONT---
임베딩(Embedding) 층의 세 파라미터 중, 어휘 사전 크기를 지정하는 것은 `input_dim`, 각 단어를 표현할 벡터의 차원은 `output_dim`, 입력 시퀀스 길이는 {{input_length}}이다.
---BACK---
- **input_dim**: 단어 사전 크기 (예: vocab_size=1000)
- **output_dim**: 임베딩 벡터 차원 (예: embedding_dim=64)
- **input_length**: 패딩 후 통일된 시퀀스 길이 (예: max_length=500)
- 이 세 값이 임베딩 행렬 크기(input_dim × output_dim)와 입력 형태를 결정

---

## @nlp-ex72-term-09
- type: func
- grade_mode: exact
- weight: 8
- answers: Bidirectional | 양방향 LSTM | BiLSTM

---FRONT---
RNN/LSTM을 앞→뒤 방향과 뒤→앞 방향 모두로 처리해 앞뒤 문맥을 동시에 학습하는 케라스 래퍼(wrapper) 층은?
---BACK---
**Bidirectional**

- 사용법: `Bidirectional(LSTM(units=64))`
- 내부적으로 순방향·역방향 LSTM을 각각 실행 후 출력을 결합
- 출력 차원 = LSTM units × 2 (양쪽 출력 연결)
- 문장 분류처럼 전체 문맥이 중요할 때 유리

---

## @nlp-ex72-term-10
- type: cloze
- weight: 8

---FRONT---
LSTM을 두 층 쌓을 때, 첫 번째 LSTM 층에 `return_sequences={{True}}`를 설정해야 두 번째 LSTM 층이 각 시점의 출력을 받을 수 있다. 마지막 LSTM 층은 `return_sequences={{False}}`(기본값)로 두어 최종 시점 출력만 반환한다.
---BACK---
- **return_sequences=True**: 모든 시점(time step)의 출력을 시퀀스로 반환 → 다음 RNN 층 입력으로 전달 가능
- **return_sequences=False** (기본): 마지막 시점 출력만 반환 → Dense 층 연결 시 사용
- LSTM 적층 구조에서 중간 층은 True, 마지막 층은 False가 일반적

---
