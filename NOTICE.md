# NOTICE — 참조·고지 / Third-Party Acknowledgements

이 문서는 `wscp-superkomi` (WebRGSS WASM mruby 런타임 + TypeScript 클라이언트)가 **영향을 받았거나 알고리즘을 참조한** 외부 프로젝트를 모두 명시합니다. **소스 코드를 직접 복사하거나 번들에 포함하지는 않습니다.** 모든 실제 구현은 자체 작성(clean-room)이며, 참조 지점은 해당 함수 상단 주석에서 URL · 파일 · 커밋 식별자를 통해 밝힙니다.

## 1. mkxp-z

- **Repo**: <https://github.com/mkxp-z/mkxp-z>
- **License**: GNU General Public License v2.0 (GPL-2.0+) — `enable-https` 빌드는 사실상 GPLv3
- **Role**: VX Ace(RGSS3) 네이티브 런타임의 동작 기준 (C++ + SDL2). Graphics/Bitmap/Sprite/Window/Plane/Tilemap/Audio 등 API의 관찰 가능한 동작 일치를 **행위 명세**로 사용.
- **사용 방식**:
  1. **코드 복사 없음.** 저장소의 `.cpp`/`.h`/`.rb`를 본 프로젝트에 포함·번들·링크하지 않습니다.
  2. **아이디어/알고리즘 참조**만 허용 (저작권 비대상).
  3. 참조한 구체 지점에 한해 아래 양식의 주석을 추가합니다:
     ```
     /*
      * Behavior ref: mkxp-z src/display/graphics.cpp Graphics::update()
      *   https://github.com/mkxp-z/mkxp-z/blob/dev/src/display/graphics.cpp
      *   License: GPL-2.0+ (not copied — observable behavior referenced only,
      *   independent implementation in clean-room manner).
      */
     ```
- **파생저작물 간주 방지 요건**:
  - 헤더/소스를 include하지 않고, 바이너리/아티팩트를 링크하지 않는다.
  - 고유 한 알고리즘이라도 수식·호출순·자료구조만 참고하고 식별성이 높은 변수명/주석은 재사용하지 않는다.
  - GPL 코드를 본 저장소에 커밋하지 않는다 (설사 주석 처리되었더라도 금지).

## 2. mkxp-web

- **Repo**: <https://github.com/pulsejet/mkxp-web>
- **License**: GNU General Public License v2.0 (GPL-2.0+)
- **Role**: Emscripten 기반 mkxp 웹 포트. WASM 로더·캔버스 부착·파일시스템 마운트의 **구성 원리** 참조.
- **사용 방식**: 1·2·3항 동일 (클린룸, 주석으로 출처 고지).

## 3. 기타 영감 자료 (참조 없음 / 공지 차원)

| 자료 | 역할 |
| --- | --- |
| RGSS3 공식 도움말(HTML) | 공개된 사양 기준. 복사 없음 |
| OpenRGSS | API 시그니처 호환성 검증에 활용 |
| RPG Maker VX Ace (Enterbrain / Kadokawa) | 상용 엔진 사양 — 리소스(`.rgss3a`/`.rvdata2`) 파싱은 공개된 Marshal 명세 기반 |

## 4. 라이선스 분리

- `wscp-superkomi` **본체는 독립 저작물**이며 상위 프로젝트(`zuzunza-waterscape`)의 라이선스 정책을 따릅니다.
- GPL 의무(소스 공개)는 **발생하지 않습니다**. 본 저장소에는 GPL 코드가 물리적으로 포함되지 않기 때문입니다.
- 만약 이후 mkxp-z/mkxp-web의 **소스 일부를 실제로 복사·포함**하기로 결정한다면, 그 시점부터 **파생저작물 요건이 발생**하여 본체 전체를 GPL-2.0+로 배포해야 합니다. 이 경우 이 문서를 업데이트하고, 상위 LICENSE 정책 변경 논의가 필요합니다.

## 5. 감사 / Acknowledgements

- **Ancurio** (mkxp 원저자)
- **mkxp-z 유지보수팀** (Ancurio, Splendide-Imaginarius, white-axe, WaywardHeart, cremno, urkle, Eblo, jonisavo 외)
- **pulsejet** (mkxp-web)

로직적 영감과 동작 기준을 제공해 주신 위 분들께 감사드립니다.

## 6. 참조 인덱스 (자동 수집 대상)

주석을 추가할 때 다음 포맷을 엄수하면 본 문서에 자동 수집 가능합니다 (향후 스크립트화):

```
/*
 * @mkxp-ref: <subpath-in-mkxp> :: <symbol-or-function>
 * @mkxp-url: https://github.com/mkxp-z/mkxp-z/blob/dev/<subpath>#L<line-approx>
 * @license-note: GPL-2.0+ (behavior ref only — clean-room implementation)
 */
```

이 양식을 통해 각 참조는 검색 가능하며, 향후 라이선스 감사(license audit) 대상이 됩니다.
