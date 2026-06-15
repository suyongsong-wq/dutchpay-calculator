// ============================================================
//  나만의 이미지 생성 서비스 — 서버 버전 (client.js)
//  ▶ 순수 바닐라 JS (React 없음). DOM을 직접 조작한다.
//  ▶ 이 파일은 "화면 조작"만 한다. 무거운 일은 모두 서버가 한다:
//     - 스타일 목록      : 서버 GET /api/styles
//     - 최종 프롬프트 조합: 서버 GET /api/preview
//     - 이미지 생성/프록시: 서버 GET /api/image  (img.src 로 사용)
//  ▶ 모든 요청이 same-origin(우리 서버)이라 CORS/다운로드 문제가 없다.
// ============================================================

(function () {
  'use strict';

  // ----- 화면 요소 참조(한 번만 찾아둔다) -----
  const $ = (id) => document.getElementById(id);
  const providerGroup = $('provider-group');
  const styleGrid    = $('style-grid');
  const promptInput  = $('prompt');
  const generateBtn  = $('generate-btn');
  const emptyHint    = $('empty-hint');
  const previewBox   = $('preview-box');
  const previewText  = $('preview-text');
  const currentStyle = $('current-style');

  const placeholder    = $('placeholder');
  const loadingEl      = $('loading');
  const errorEl        = $('error');
  const errorText      = $('error-text');
  const resultImg      = $('result-img');
  const resultActions  = $('result-actions');
  const regenerateBtn  = $('regenerate-btn');
  const retryBtn       = $('retry-btn');
  const downloadLink   = $('download-link');
  const usedStyle      = $('used-style');
  const usedSeed       = $('used-seed');

  // ----- 상태(앱이 기억하는 값) -----
  let presets = [];                     // 서버에서 받아온 스타일 프리셋 배열
  let selectedStyle = null;             // 현재 선택된 스타일 id
  let selectedProvider = 'pollinations'; // 현재 선택된 이미지 엔진(provider)
  let submitted = null;                 // 마지막으로 "생성"한 값 { prompt, styleId, seed, provider }

  // 새 랜덤 seed 만들기 (같은 프롬프트라도 seed가 다르면 결과가 달라진다)
  const newSeed = () => Math.floor(Math.random() * 1_000_000);

  // ============================================================
  //  1) 페이지 로드 → 서버에서 스타일 프리셋을 받아 카드 그리드 렌더
  // ============================================================
  async function loadStyles() {
    try {
      const res = await fetch('/api/styles');
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '스타일 로드 실패');
      presets = json.data;
      renderStyleCards();
      // 기본값: 첫 번째 스타일 선택
      selectStyle(presets[0].id);
    } catch (err) {
      styleGrid.innerHTML =
        `<p class="col-span-full text-sm text-rose-300">스타일을 불러오지 못했습니다: ${err.message}</p>`;
    }
  }

  // 카드 그리드를 그린다. (선택 강조는 CSS의 .is-selected 클래스로 처리)
  function renderStyleCards() {
    styleGrid.innerHTML = '';
    presets.forEach((p) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.dataset.id = p.id;
      card.className =
        'style-card group relative text-left rounded-2xl p-4 border border-white/10 bg-white/[0.02] ' +
        'hover:bg-white/[0.05] hover:border-white/25 overflow-hidden ' +
        'focus:outline-none focus:ring-2 focus:ring-violet-400/60';
      card.innerHTML =
        '<span class="accent-bar absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-fuchsia-500"></span>' +
        '<div class="flex items-start justify-between">' +
          `<span class="text-2xl">${p.emoji}</span>` +
          '<span class="check-badge text-violet-300 text-xs font-bold items-center gap-1">✔ 선택됨</span>' +
        '</div>' +
        `<div class="mt-2 font-bold text-[15px] text-slate-50">${p.label}</div>` +
        `<div class="mt-0.5 text-xs text-slate-400 leading-snug">${p.desc || ''}</div>`;
      // 클릭 → 선택
      card.addEventListener('click', () => selectStyle(p.id));
      styleGrid.appendChild(card);
    });
  }

  // 스타일 선택: 상태 갱신 + 카드 강조 + 현재 화풍 표시 + 미리보기 갱신
  function selectStyle(id) {
    selectedStyle = id;
    // 모든 카드에서 강조 제거 후, 선택된 카드만 강조
    styleGrid.querySelectorAll('.style-card').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.id === id);
    });
    const p = presets.find((s) => s.id === id);
    if (p) currentStyle.textContent = `${p.emoji} ${p.label}`;
    updatePreview(); // 스타일이 바뀌면 최종 프롬프트도 바뀐다
  }

  // ============================================================
  //  1-b) provider(이미지 엔진) 선택
  //   세그먼트 버튼 중 하나를 누르면 selectedProvider 를 갱신하고
  //   강조 클래스(.is-active)를 토글한다. 이후 모든 요청 쿼리에 반영된다.
  // ============================================================
  function selectProvider(provider) {
    // 허용: 'fal' | 'huggingface' | 'pollinations'(기본)
    selectedProvider = (provider === 'fal' || provider === 'huggingface')
      ? provider : 'pollinations';
    providerGroup.querySelectorAll('.provider-card').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.provider === selectedProvider);
    });
    updatePreview(); // provider 가 바뀌어도 미리보기(특히 provider 표시)를 갱신
  }

  // ============================================================
  //  2) 입력/버튼 상태 관리 + 최종 프롬프트 미리보기
  // ============================================================

  // 입력이 비었는지에 따라 버튼 활성/비활성, 안내문구 토글
  function syncButtonState() {
    const has = promptInput.value.trim().length > 0;
    generateBtn.disabled = !has;
    emptyHint.classList.toggle('hidden', has);
  }

  // 서버에 /api/preview 를 물어 "최종 조합 프롬프트"를 받아 표시 (교육용)
  // 입력이 바뀔 때마다 호출되므로, 입력이 비면 미리보기를 숨긴다.
  async function updatePreview() {
    const prompt = promptInput.value.trim();
    if (!prompt || !selectedStyle) {
      previewBox.classList.add('hidden');
      return;
    }
    try {
      const url = `/api/preview?prompt=${encodeURIComponent(prompt)}` +
                  `&style=${encodeURIComponent(selectedStyle)}` +
                  `&provider=${encodeURIComponent(selectedProvider)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        previewText.textContent = json.data.finalPrompt;
        previewBox.classList.remove('hidden');
      }
    } catch (_) {
      // 미리보기는 부가 기능이라 실패해도 조용히 무시
    }
  }

  // ============================================================
  //  3) 이미지 생성 — 서버의 /api/image 를 img.src 로 설정
  //     서버가 프롬프트 조합 + Pollinations 프록시를 모두 처리하므로
  //     클라이언트는 "주소만" 만들어 넣으면 된다.
  // ============================================================

  // 화면 상태 전환 헬퍼들 (placeholder / loading / error / done)
  function showLoading() {
    placeholder.classList.add('hidden');
    errorEl.classList.add('hidden');
    resultActions.classList.add('hidden');
    loadingEl.classList.remove('hidden');
    resultImg.classList.add('opacity-0');
    resultImg.classList.remove('fade-in');
  }
  // msg 를 주면 서버가 준 한국어 에러 메시지를 보기 좋게 표시한다.
  function showError(msg) {
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    resultActions.classList.add('hidden');
    errorText.innerHTML = msg
      ? String(msg)
      : '이미지를 불러오지 못했어요.<br/>잠시 후 다시 시도해 주세요.';
  }
  function showDone() {
    loadingEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    placeholder.classList.add('hidden');
    resultImg.classList.remove('opacity-0');
    resultImg.classList.add('fade-in');
    resultActions.classList.remove('hidden');
  }

  // submitted 값으로 서버 이미지 URL을 만든다.
  function buildImageUrl(s) {
    return `/api/image?prompt=${encodeURIComponent(s.prompt)}` +
           `&style=${encodeURIComponent(s.styleId)}` +
           `&seed=${encodeURIComponent(s.seed)}` +
           `&provider=${encodeURIComponent(s.provider)}`;
  }

  // 실제 이미지 요청 시작: img.src 를 서버 주소로 설정 → 로딩 표시
  function startGeneration(s) {
    submitted = s;
    showLoading();
    const url = buildImageUrl(s);
    // img.src 에 넣으면 브라우저가 우리 서버(/api/image)로 GET 요청을 보낸다.
    // 서버는 프롬프트를 조합 → Pollinations 에서 받아온 이미지를 스트리밍으로 응답.
    resultImg.src = url;

    // 다운로드 링크도 같은 서버 주소(same-origin) → a[download] 로 바로 저장된다.
    downloadLink.href = url;
    downloadLink.download = `ai-image-${s.styleId}-${s.seed}.jpg`;
  }

  // <img> 의 로드 완료/실패 감지
  resultImg.addEventListener('load', () => {
    // src 가 비어있는 초기 상태에서 잘못 발동하지 않도록 가드
    if (!submitted || !resultImg.getAttribute('src')) return;
    // 결과 정보 채우기
    const p = presets.find((s) => s.id === submitted.styleId);
    usedStyle.textContent = p ? p.label : submitted.styleId;
    usedSeed.textContent = submitted.seed;
    showDone();
  });
  resultImg.addEventListener('error', () => {
    if (!submitted) return;
    // <img> 의 error 이벤트만으로는 서버가 보낸 JSON 에러 메시지를 읽을 수 없다.
    // (특히 fal provider 에서 FAL_KEY 미설정 시 서버는 503 JSON 을 돌려준다.)
    // 같은 URL 을 한 번 더 fetch 해서 JSON 이면 그 메시지를 표시한다.
    const failed = submitted;
    fetch(buildImageUrl(failed))
      .then((r) => {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return r.json().then((j) => showError(j.message));
        }
        // JSON 이 아니면(이미지인데 표시만 실패 등) 기본 안내
        showError();
      })
      .catch(() => showError());
  });

  // "이미지 생성" 클릭: 현재 입력값을 확정 + 새 seed 로 생성
  function handleGenerate() {
    const prompt = promptInput.value.trim();
    if (!prompt || !selectedStyle) return;
    startGeneration({ prompt, styleId: selectedStyle, provider: selectedProvider, seed: newSeed() });
  }

  // "다시 생성": 프롬프트/스타일은 그대로, seed 만 새로 → 다른 결과
  function handleRegenerate() {
    if (!submitted) return;
    startGeneration({ ...submitted, seed: newSeed() });
  }

  // ============================================================
  //  이벤트 연결
  // ============================================================
  promptInput.addEventListener('input', () => {
    syncButtonState();
    updatePreview();
  });

  // Enter 로 생성 (Shift+Enter 는 줄바꿈)
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  });

  // provider 세그먼트 버튼 클릭 → 엔진 선택
  providerGroup.querySelectorAll('.provider-card').forEach((btn) => {
    btn.addEventListener('click', () => selectProvider(btn.dataset.provider));
  });

  generateBtn.addEventListener('click', handleGenerate);
  regenerateBtn.addEventListener('click', handleRegenerate);
  retryBtn.addEventListener('click', handleRegenerate);

  // ============================================================
  //  시작
  // ============================================================
  syncButtonState();
  selectProvider('pollinations'); // 기본 엔진: Pollinations (무료·키 불필요)
  loadStyles();
})();
