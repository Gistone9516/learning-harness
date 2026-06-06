/**
 * aws / _example / activities.js
 * ─────────────────────────────────────────────────────────────────
 * aws 플러그인 ActivitySpec 예제 데이터.
 * window.ACTIVITIES["aws"] 배열에 등록.
 *
 * ActivitySpec (aws 플러그인 확정 스펙):
 *   type        : "cloud-task"
 *   front       : {
 *                   prompt       : string,          // 과제 설명
 *                   provider     : "aws",
 *                   service      : string,          // 예: "S3", "IAM"
 *                   task         : string,          // 한 줄 요약
 *                   checkpoints  : string[],        // 달성 단계 (학습자 가이드)
 *                   cli_hint?    : string           // AWS CLI 힌트 (선택)
 *                 }
 *   back        : {
 *                   solution?    : string,          // 예시 CLI 절차 (개행 포함)
 *                   explanation? : string           // 개념 설명
 *                 }
 *   grading     : {
 *                   checks       : [
 *                     {
 *                       type       : "resource-exists" | "config-equals",
 *                       service    : string,        // AWS 서비스 키 (예: "s3", "iam")
 *                       identifier : string,        // 리소스 식별자
 *                       expected?  : any            // config-equals 전용: 기대값
 *                     }
 *                   ],
 *                   grader       : "boto3"
 *                 }
 *
 * 채점 흐름:
 *   플러그인 "검증" 버튼 →
 *   POST {entry_url}/grade  { activity_id, checks } →
 *   백엔드(grade.py, boto3)가 LocalStack(로컬 Docker) 또는
 *   사용자 AWS 계정에서 리소스 상태 확인 →
 *   { passed, total, details } 반환 →
 *   ScoreResult = {
 *     verdict   : "correct" | "incorrect" | "pending",
 *     score_raw : passed / total  (0..1),
 *     grader_id : "external",
 *     feedback  : { passed, total, details }
 *   }
 *
 *   entry_url 미연결 / 헬스체크 실패 시 graceful:
 *     verdict = "pending",
 *     score_raw = 0,
 *     feedback.message = "LocalStack 또는 AWS 백엔드 연결 필요"
 *
 * 파킹 (전부 사용자 인프라):
 *   - LocalStack Docker 실행 (docker run localstack/localstack)
 *   - 또는 본인 AWS 계정 + ~/.aws/credentials 설정
 *   - 백엔드(grade.py) 실행 (python grade.py)
 *   - 비용·X-Frame 이슈로 AWS 콘솔 직접 임베드 불가 → 가이드+검증 방식
 *
 * 문제 선정 기준: 보편·저비용·무편향 AWS 기초 실습.
 *   1. S3 버킷 생성 + 버저닝 활성화
 *   2. IAM 사용자 생성 + 특정 정책 연결
 * ─────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['aws'] = [

    /* ────────────────────────────────────────────────────────────
       1. S3 버킷 생성 + 버저닝 활성화

       학습 목표:
         - S3 버킷 생성 (전역 고유 이름 규칙 이해)
         - 버저닝(Versioning) 개념과 활성화 절차
         - AWS CLI s3api 기본 사용법

       boto3 검증:
         check 1 — resource-exists: s3.head_bucket(Bucket=identifier) 성공 여부
         check 2 — config-equals:   get_bucket_versioning(Bucket=identifier)
                                    ["Status"] == "Enabled"
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'aws-ex-001',
      type: 'cloud-task',
      front: {
        prompt: [
          'AWS S3에서 새 버킷을 생성하고, 해당 버킷에 버저닝(Versioning)을 활성화하라.',
          '',
          '버킷 이름은 my-versioned-bucket-<고유번호> 형식으로 지정한다.',
          '(예: my-versioned-bucket-20260607)',
          '',
          '※ S3 버킷 이름은 전 세계적으로 고유해야 하며,',
          '   소문자·숫자·하이픈만 사용 가능하고 3~63자 이내여야 한다.',
          '',
          '※ LocalStack 사용 시 리전 제약이 없으나,',
          '   실제 AWS 계정에서는 us-east-1 이외의 리전에서 생성할 때',
          '   --create-bucket-configuration LocationConstraint=<리전> 옵션이 필요하다.'
        ].join('\n'),
        provider: 'aws',
        service: 'S3',
        task: 'S3 버킷 생성 후 버저닝 활성화',
        checkpoints: [
          '1. 고유한 버킷 이름을 결정한다 (예: my-versioned-bucket-20260607).',
          '2. aws s3api create-bucket 명령으로 버킷을 생성한다.',
          '3. aws s3api put-bucket-versioning 명령으로 버저닝을 Enabled 상태로 설정한다.',
          '4. aws s3api get-bucket-versioning 명령으로 Status가 "Enabled"인지 확인한다.',
          '5. "검증" 버튼을 클릭해 채점한다.'
        ],
        cli_hint: [
          '# 버킷 생성 (us-east-1)',
          'aws s3api create-bucket --bucket my-versioned-bucket-20260607 --region us-east-1',
          '',
          '# us-east-1 이외 리전 사용 시 (예: ap-northeast-2)',
          '# aws s3api create-bucket --bucket my-versioned-bucket-20260607 \\',
          '#   --region ap-northeast-2 \\',
          '#   --create-bucket-configuration LocationConstraint=ap-northeast-2',
          '',
          '# 버저닝 활성화',
          'aws s3api put-bucket-versioning \\',
          '  --bucket my-versioned-bucket-20260607 \\',
          '  --versioning-configuration Status=Enabled',
          '',
          '# 버저닝 상태 확인',
          'aws s3api get-bucket-versioning --bucket my-versioned-bucket-20260607'
        ].join('\n')
      },
      back: {
        solution: [
          '# 1. 버킷 생성 (us-east-1 기준)',
          'aws s3api create-bucket \\',
          '  --bucket my-versioned-bucket-20260607 \\',
          '  --region us-east-1',
          '',
          '# 2. 버저닝 활성화',
          'aws s3api put-bucket-versioning \\',
          '  --bucket my-versioned-bucket-20260607 \\',
          '  --versioning-configuration Status=Enabled',
          '',
          '# 3. 결과 확인 (Status: Enabled 반환 기대)',
          'aws s3api get-bucket-versioning \\',
          '  --bucket my-versioned-bucket-20260607'
        ].join('\n'),
        explanation: [
          'S3 버킷 이름은 전 세계(모든 AWS 계정 포함)에서 고유해야 한다.',
          '',
          '버저닝(Versioning)이란?',
          '  - 동일 키(Key)로 객체를 덮어쓰거나 삭제할 때 이전 버전을 보존하는 기능.',
          '  - 실수로 삭제하거나 덮어쓴 객체를 이전 버전으로 복원할 수 있다.',
          '  - 활성화 후에는 비활성화(Disabled)가 아닌 일시 중지(Suspended)만 가능.',
          '',
          'put-bucket-versioning의 --versioning-configuration 값:',
          '  Status=Enabled   → 버저닝 활성화',
          '  Status=Suspended → 버저닝 일시 중지 (기존 버전 유지, 신규 버전 비생성)'
        ].join('\n')
      },
      grading: {
        checks: [
          {
            type: 'resource-exists',
            service: 's3',
            identifier: 'my-versioned-bucket-20260607'
          },
          {
            type: 'config-equals',
            service: 's3',
            identifier: 'my-versioned-bucket-20260607',
            expected: { key: 'versioning.Status', value: 'Enabled' }
          }
        ],
        grader: 'boto3'
      }
    },

    /* ────────────────────────────────────────────────────────────
       2. IAM 사용자 생성 + AmazonS3ReadOnlyAccess 정책 연결

       학습 목표:
         - IAM 사용자 생성 (AWS 자격증명 관리 기초)
         - 관리형 정책(Managed Policy) 개념 이해
         - 최소 권한 원칙(Least Privilege): ReadOnly 수준 정책 선택 이유
         - AWS CLI iam 서브커맨드 기본 사용법

       boto3 검증:
         check 1 — resource-exists: iam.get_user(UserName=identifier) 성공 여부
         check 2 — config-equals:   list_attached_user_policies(UserName=identifier)
                                    중 PolicyArn == "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess" 포함 여부
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'aws-ex-002',
      type: 'cloud-task',
      front: {
        prompt: [
          'IAM에서 새 사용자를 생성하고, AWS 관리형 정책인',
          'AmazonS3ReadOnlyAccess를 해당 사용자에게 연결하라.',
          '',
          '사용자 이름: s3-readonly-user',
          '',
          '※ IAM 사용자는 장기 자격증명(액세스 키)을 발급할 수 있는 엔티티다.',
          '   실습 목적 외에는 최소 권한 원칙에 따라 필요한 정책만 부여해야 한다.',
          '',
          '※ AmazonS3ReadOnlyAccess ARN:',
          '   arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'
        ].join('\n'),
        provider: 'aws',
        service: 'IAM',
        task: 'IAM 사용자 생성 + AmazonS3ReadOnlyAccess 정책 연결',
        checkpoints: [
          '1. aws iam create-user 명령으로 s3-readonly-user 사용자를 생성한다.',
          '2. aws iam attach-user-policy 명령으로 AmazonS3ReadOnlyAccess 정책을 연결한다.',
          '3. aws iam list-attached-user-policies 명령으로 정책 연결을 확인한다.',
          '4. "검증" 버튼을 클릭해 채점한다.'
        ],
        cli_hint: [
          '# IAM 사용자 생성',
          'aws iam create-user --user-name s3-readonly-user',
          '',
          '# AmazonS3ReadOnlyAccess 정책 연결',
          'aws iam attach-user-policy \\',
          '  --user-name s3-readonly-user \\',
          '  --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
          '',
          '# 연결된 정책 확인',
          'aws iam list-attached-user-policies --user-name s3-readonly-user'
        ].join('\n')
      },
      back: {
        solution: [
          '# 1. IAM 사용자 생성',
          'aws iam create-user --user-name s3-readonly-user',
          '',
          '# 2. AWS 관리형 정책 연결 (AmazonS3ReadOnlyAccess)',
          'aws iam attach-user-policy \\',
          '  --user-name s3-readonly-user \\',
          '  --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
          '',
          '# 3. 연결 확인',
          'aws iam list-attached-user-policies --user-name s3-readonly-user',
          '',
          '# (선택) 실습 완료 후 정리',
          '# aws iam detach-user-policy \\',
          '#   --user-name s3-readonly-user \\',
          '#   --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
          '# aws iam delete-user --user-name s3-readonly-user'
        ].join('\n'),
        explanation: [
          'IAM(Identity and Access Management)은 AWS 리소스에 대한 접근을 제어하는 서비스다.',
          '',
          '관리형 정책(Managed Policy):',
          '  - AWS 관리형: AWS가 생성·유지 관리 (예: AmazonS3ReadOnlyAccess).',
          '  - 고객 관리형: 사용자가 직접 정의.',
          '  - 인라인 정책(Inline Policy)과 달리 여러 엔티티에 재사용 가능.',
          '',
          '최소 권한 원칙(Principle of Least Privilege):',
          '  - 업무에 필요한 최소한의 권한만 부여.',
          '  - ReadOnly 정책은 S3 객체 읽기(GetObject, ListBucket 등)만 허용,',
          '    쓰기·삭제는 차단되어 실수로 인한 데이터 손실 위험을 줄인다.',
          '',
          'AmazonS3ReadOnlyAccess ARN 형식:',
          '  arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
          '  (계정 ID 없이 aws 파티션 전역에서 동일하게 참조 가능)'
        ].join('\n')
      },
      grading: {
        checks: [
          {
            type: 'resource-exists',
            service: 'iam',
            identifier: 's3-readonly-user'
          },
          {
            type: 'config-equals',
            service: 'iam',
            identifier: 's3-readonly-user',
            expected: {
              key: 'attached_policies.includes',
              value: 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'
            }
          }
        ],
        grader: 'boto3'
      }
    }

  ];

})();
