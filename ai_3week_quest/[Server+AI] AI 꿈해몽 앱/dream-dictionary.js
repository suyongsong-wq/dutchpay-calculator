/**
 * 한국식 꿈해몽 사전
 * - match: 꿈 텍스트에서 찾을 키워드(부분 일치)
 * - kw: 화면에 보여줄 상징 이름
 * - category: 분류
 * - luck: 행운지수 가감 (-20 ~ +25)
 * - verdict: 길흉 판정 (없으면 luck·점수로 추정)
 * - meaning: 해몽 뜻 (한 줄)
 */

const DREAM_SYMBOLS = [
  // ── 동물 ──
  { match: ['돼지', '멧돼지'], kw: '돼지', category: '동물', luck: +25, verdict: '길몽', meaning: '재물과 행운이 따르는 대표적인 길몽이에요.' },
  { match: ['용', '용왕'], kw: '용', category: '동물', luck: +22, verdict: '길몽', meaning: '큰 승진·명예·도약의 기운이 깃든 상징이에요.' },
  { match: ['뱀', '구렁이', '뱀물'], kw: '뱀', category: '동물', luck: +12, verdict: '길몽', meaning: '재물·지혜·변화를 뜻하며, 때로는 귀인을 상징해요.' },
  { match: ['호랑이', '범'], kw: '호랑이', category: '동물', luck: +18, verdict: '길몽', meaning: '권위·용기·큰 성취의 기운을 담고 있어요.' },
  { match: ['물고기', '고기 잡', '붕어', '잉어', '연어'], kw: '물고기', category: '동물', luck: +16, verdict: '길몽', meaning: '금전운·풍요·좋은 소식이 다가올 수 있어요.' },
  { match: ['닭', '계란', '병아리', '암탉'], kw: '닭·계란', category: '동물', luck: +14, verdict: '길몽', meaning: '새로운 시작·좋은 소식·결실의 전조예요.' },
  { match: ['소', '황소', '젖소'], kw: '소', category: '동물', luck: +15, verdict: '길몽', meaning: '안정·재물·성실한 노력의 결실을 뜻해요.' },
  { match: ['말', '말타', '승마'], kw: '말', category: '동물', luck: +10, verdict: '길몽', meaning: '속도감 있는 변화·추진력·성공 가능성을 나타내요.' },
  { match: ['개', '강아지', '멍멍'], kw: '개', category: '동물', luck: +8, meaning: '충성·우정·든든한 조력자를 상징해요.' },
  { match: ['고양이', '냥이'], kw: '고양이', category: '동물', luck: +5, meaning: '직감·독립·은밀한 기회를 뜻할 수 있어요.' },
  { match: ['새', '학', '비둘기', '참새', '까치'], kw: '새', category: '동물', luck: +12, verdict: '길몽', meaning: '소식·자유·희망·승진운과 연결되는 경우가 많아요.' },
  { match: ['나비', '나비날'], kw: '나비', category: '동물', luck: +10, verdict: '길몽', meaning: '변화·인연·아름다운 전환을 상징해요.' },
  { match: ['벌', '벌집', '꿀벌'], kw: '벌', category: '동물', luck: +6, meaning: '부지런함·성과·달콤한 보상을 암시해요.' },
  { match: ['쥐', '쥐떼'], kw: '쥐', category: '동물', luck: -8, verdict: '흉몽', meaning: '손실·걱정·사소한 방해를 경계하는 상징이에요.' },
  { match: ['거미', '거미줄'], kw: '거미', category: '동물', luck: -5, meaning: '얽힘·인내 시험·조급함을 돌아보라는 신호일 수 있어요.' },
  { match: ['벌레', '애벌레', '지네', '지렁이'], kw: '벌레', category: '동물', luck: -6, verdict: '흉몽', meaning: '불편함·걱정거리·스트레스가 쌓였을 수 있어요.' },

  // ── 자연 ──
  { match: ['물', '바다', '강', '호수', '연못', '폭포'], kw: '물', category: '자연', luck: +8, meaning: '감정·무의식·흐름의 변화를 뜻해요. 맑은 물은 길한 편이에요.' },
  { match: ['비', '폭우', '소나기', '장마'], kw: '비', category: '자연', luck: +6, meaning: '정화·새로운 기운·감정의 씻김을 상징해요.' },
  { match: ['눈', '눈사람', '폭설'], kw: '눈', category: '자연', luck: +4, meaning: '순수·새 출발·잠시 멈춤과 휴식을 뜻할 수 있어요.' },
  { match: ['태양', '해', '햇빛', '일출'], kw: '태양', category: '자연', luck: +14, verdict: '길몽', meaning: '명예·성공·희망·에너지가 충만해지는 상징이에요.' },
  { match: ['달', '보름달', '초승달'], kw: '달', category: '자연', luck: +7, meaning: '감정·여성성·직관·은은한 변화를 나타내요.' },
  { match: ['별', '유성', '별똥별'], kw: '별', category: '자연', luck: +12, verdict: '길몽', meaning: '소원 성취·영감·운명의 전조를 뜻해요.' },
  { match: ['무지개', '쌍무지개'], kw: '무지개', category: '자연', luck: +15, verdict: '길몽', meaning: '희망·화해·어려움 뒤의 좋은 전환을 상징해요.' },
  { match: ['산', '정상', '등산', '오르'], kw: '산', category: '자연', luck: +10, verdict: '길몽', meaning: '목표·성취·꾸준한 노력의 결실을 뜻해요.' },
  { match: ['꽃', '정원', '벚꽃', '장미', '해바라기'], kw: '꽃', category: '자연', luck: +12, verdict: '길몽', meaning: '개화·인연·사랑·아름다운 결과를 상징해요.' },
  { match: ['나무', '숲', '대나무', '소나무'], kw: '나무', category: '자연', luck: +9, meaning: '성장·뿌리·안정·지속 가능한 발전을 뜻해요.' },
  { match: ['불', '화재', '불꽃', '불타'], kw: '불', category: '자연', luck: +10, verdict: '길몽', meaning: '번영·열정·강한 변화의 에너지를 담고 있어요.' },
  { match: ['번개', '천둥', '뇌우'], kw: '번개', category: '자연', luck: -4, meaning: '갑작스런 변화·충격·긴장감을 암시할 수 있어요.' },
  { match: ['지진', '흔들', '건물 무너'], kw: '지진', category: '자연', luck: -12, verdict: '흉몽', meaning: '근본적 변화·불안·기반의 흔들림을 뜻해요.' },
  { match: ['안개', '짙은 안개'], kw: '안개', category: '자연', luck: -5, meaning: '방향 상실·혼란·아직 보이지 않는 미래를 나타내요.' },

  // ── 사람 ──
  { match: ['아기', '임신', '출산', '아이', '태아'], kw: '새 시작', category: '사람', luck: +14, verdict: '길몽', meaning: '새 프로젝트·창조·가능성의 시작을 상징해요.' },
  { match: ['결혼', '웨딩', '신랑', '신부', '백년가약'], kw: '결혼', category: '사람', luck: +12, verdict: '길몽', meaning: '새로운 관계·약속·인연의 결실을 뜻해요.' },
  { match: ['연인', '남친', '여친', '좋아하는 사람', '키스'], kw: '연인', category: '사람', luck: +8, meaning: '감정·친밀감·관계에 대한 열망을 반영해요.' },
  { match: ['부모', '아버지', '어머니', '엄마', '아빠'], kw: '부모', category: '사람', luck: +3, meaning: '뿌리·보호·책임·가정에 대한 마음을 뜻해요.' },
  { match: ['조상', '할머니', '할아버지', '돌아가신'], kw: '조상', category: '사람', luck: +6, meaning: '보호·조언·내면의 지혜를 전하는 상징일 수 있어요.' },
  { match: ['친구', '동창', '절친'], kw: '친구', category: '사람', luck: +5, meaning: '지지·협력·소속감에 대한 욕구를 나타내요.' },
  { match: ['선생님', '교수', '스승'], kw: '스승', category: '사람', luck: +4, meaning: '배움·성장·규칙·가르침을 상징해요.' },
  { match: ['낯선 사람', '모르는 사람', '처음 보는'], kw: '낯선 이', category: '사람', luck: 0, meaning: '새로운 가능성·미지의 자아·변화를 뜻할 수 있어요.' },
  { match: ['죽', '시체', '장례', '관', '매장'], kw: '죽음', category: '사람', luck: +5, verdict: '반길몽반흉몽', meaning: '끝이 아닌 전환·새 출발·오래된 것의 마무리를 뜻해요.' },

  // ── 사물·재물 ──
  { match: ['똥', '대변', '오물', '변기'], kw: '똥', category: '사물', luck: +22, verdict: '길몽', meaning: '한국 해몽에서 재물·금전운의 대표 길몽이에요.' },
  { match: ['돈다발', '돈뭉치', '현금다발', '지폐 뭉치', '돈벼락'], kw: '돈다발', category: '사물', luck: +24, verdict: '길몽', meaning: '큰 재물·횡재수·뜻밖의 수입이 들어올 강력한 길몽이에요.' },
  { match: ['돈', '금', '보석', '금괴', '복권', '지폐', '동전', '재물'], kw: '재물', category: '사물', luck: +18, verdict: '길몽', meaning: '금전·기회·가치 상승의 기운이 강해요.' },
  { match: ['우리집', '새 집', '집을 사', '집을 지', '이사'], kw: '집', category: '사물', luck: +8, meaning: '안정·자아·가정·소속에 대한 상태를 반영해요.' },
  { match: ['열쇠', '자물쇠', '문 열'], kw: '열쇠', category: '사물', luck: +11, verdict: '길몽', meaning: '새로운 기회·해답·문이 열리는 전환을 뜻해요.' },
  { match: ['옷', '드레스', '정장', '유니폼'], kw: '옷', category: '사물', luck: +6, meaning: '새 이미지·역할 변화·사회적 면모를 상징해요.' },
  { match: ['신발', '운동화', '구두'], kw: '신발', category: '사물', luck: +5, meaning: '진로·방향·걸어갈 길에 대한 메시지일 수 있어요.' },
  { match: ['가방', '지갑', '백팩'], kw: '가방', category: '사물', luck: +4, meaning: '준비·책임·소지한 능력·짐을 뜻해요.' },
  { match: ['거울', '유리'], kw: '거울', category: '사물', luck: -3, meaning: '자아 성찰·외모·진실을 마주하는 상징이에요.' },
  { match: ['거울 깨', '깨진 거울'], kw: '깨진 거울', category: '사물', luck: -10, verdict: '흉몽', meaning: '자아 혼란·관계 균열·불안을 암시할 수 있어요.' },
  { match: ['칼', '칼에 찔', '피', '상처', '피흘'], kw: '칼·피', category: '사물', luck: -9, verdict: '흉몽', meaning: '갈등·상처·예리한 감정의 표출을 뜻해요.' },
  { match: ['시계', '늦', '알람'], kw: '시계', category: '사물', luck: -4, meaning: '시간 압박·기한·인생의 흐름을 상징해요.' },
  { match: ['책', '공부', '시험지', '노트'], kw: '책', category: '사물', luck: +3, meaning: '배움·지식·준비 상태를 반영해요.' },
  { match: ['자동차', '운전', '버스', '지하철', '기차'], kw: '이동수단', category: '사물', luck: +2, meaning: '인생의 속도·방향·통제감에 대한 메시지예요.' },
  { match: ['비행기', '공항', '여행'], kw: '여행', category: '사물', luck: +9, meaning: '확장·도약·새로운 환경으로의 이동을 뜻해요.' },
  { match: ['다리', '대교', '건너'], kw: '다리', category: '사물', luck: +10, verdict: '길몽', meaning: '연결·인연·어려움을 건너는 통로를 상징해요.' },

  // ── 음식 ──
  { match: ['밥', '쌀', '국', '찌개', '밥상'], kw: '밥', category: '음식', luck: +10, verdict: '길몽', meaning: '풍요·안정·생활 기반의 튼튼함을 뜻해요.' },
  { match: ['과일', '사과', '복숭아', '수박', '포도', '딸기'], kw: '과일', category: '음식', luck: +11, verdict: '길몽', meaning: '달콤한 결실·행운·노력의 열매를 상징해요.' },
  { match: ['떡', '케이크', '생일', '디저트'], kw: '떡·케이크', category: '음식', luck: +8, meaning: '축하·기쁨·나눔·특별한 날의 기운이에요.' },
  { match: ['고기', '삼겹살', '갈비', '치킨'], kw: '고기', category: '음식', luck: +7, meaning: '풍요·만족·에너지 충전을 뜻할 수 있어요.' },
  { match: ['술', '맥주', '소주', '취'], kw: '술', category: '음식', luck: -2, meaning: '해방·충동·현실 도피 욕구를 반영할 수 있어요.' },

  // ── 신체 ──
  { match: ['이빨', '이가 빠', '치아', '이 빠', '사랑니'], kw: '이빨 빠짐', category: '신체', luck: -10, verdict: '흉몽', meaning: '걱정·상실·자존감 흔들림을 암시하는 흔한 꿈이에요.' },
  { match: ['머리카락', '대머리', '탈모', '머리 깎'], kw: '머리카락', category: '신체', luck: -6, meaning: '자아·체면·건강에 대한 불안을 뜻할 수 있어요.' },
  { match: ['손톱', '발톱'], kw: '손톱', category: '신체', luck: -5, meaning: '방어·보호·작은 상실에 대한 신호일 수 있어요.' },
  { match: ['목욕', '샤워', '세수', '목욕탕'], kw: '목욕', category: '신체', luck: +9, verdict: '길몽', meaning: '정화·새 출발·마음의 씻김을 상징해요.' },
  { match: ['달리', '뛰', '전력 질주'], kw: '달리기', category: '신체', luck: +2, meaning: '도피·추진력·목표를 향한 열망을 나타내요.' },

  // ── 행동·상황 ──
  { match: ['날', '하늘', '비행', '날아', '공중'], kw: '비상', category: '행동', luck: +15, verdict: '길몽', meaning: '자유·해방·한 단계 도약의 강한 상징이에요.' },
  { match: ['떨어', '추락', '절벽'], kw: '추락', category: '행동', luck: -15, verdict: '흉몽', meaning: '불안·통제 상실·자신감 흔들림을 뜻해요.' },
  { match: ['쫓', '도망', '추격', '도망치'], kw: '쫓김', category: '행동', luck: -12, verdict: '흉몽', meaning: '회피하고 싶은 스트레스·책임·압박을 반영해요.' },
  { match: ['싸움', '다툼', '전쟁', '주먹'], kw: '갈등', category: '행동', luck: -6, meaning: '내면·대인 갈등·억눌린 분노가 표출될 수 있어요.' },
  { match: ['길을 잃', '미로', '헤매', '길 모르'], kw: '방황', category: '행동', luck: -7, meaning: '방향 상실·결정의 어려움·혼란을 뜻해요.' },
  { match: ['시험', '지각', '발표', '면접', '수능'], kw: '시험', category: '행동', luck: -8, verdict: '흉몽', meaning: '평가·압박·준비 부족에 대한 불안이 크게 나타나요.' },
  { match: ['물에 빠', '익사', '수영 못'], kw: '익수', category: '행동', luck: -11, verdict: '흉몽', meaning: '감정 과부하·압도당함·숨 막히는 상황을 상징해요.' },
  { match: ['잃어버', '분실', '못 찾'], kw: '분실', category: '행동', luck: -6, meaning: '소중한 것에 대한 불안·통제 상실을 뜻해요.' },
  { match: ['늦', '지각', '시간 없'], kw: '지각', category: '행동', luck: -7, meaning: '시간 압박·기회 상실에 대한 걱정이에요.' },
  { match: ['노래', '춤', '공연', '무대'], kw: '공연', category: '행동', luck: +8, meaning: '자기 표현·인정 욕구·재능 발휘를 뜻해요.' },
  { match: ['웃', '기쁨', '행복', '즐거'], kw: '기쁨', category: '행동', luck: +12, verdict: '길몽', meaning: '긍정적 전환·마음의 여유·좋은 기운이에요.' },
  { match: ['울', '눈물', '슬픔'], kw: '눈물', category: '행동', luck: +3, meaning: '감정 해방·정화·오래 쌓인 마음의 배출일 수 있어요.' },
];

const CATEGORIES = ['전체', ...new Set(DREAM_SYMBOLS.map((s) => s.category))];

/** 꿈 텍스트에서 매칭되는 상징 찾기 (긴 키워드 우선) */
function matchSymbols(text) {
  const t = String(text);
  const matched = DREAM_SYMBOLS.filter((s) => s.match.some((m) => t.includes(m)));
  matched.sort((a, b) => {
    const maxA = Math.max(...a.match.map((m) => m.length));
    const maxB = Math.max(...b.match.map((m) => m.length));
    return maxB - maxA;
  });
  return matched;
}

/** 사전 검색 (키워드·뜻·매칭어) */
function searchDictionary(query, category) {
  let list = [...DREAM_SYMBOLS];
  if (category && category !== '전체') {
    list = list.filter((s) => s.category === category);
  }
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => {
    const hay = [s.kw, s.meaning, s.category, ...s.match].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

module.exports = { DREAM_SYMBOLS, CATEGORIES, matchSymbols, searchDictionary };
