<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  watchEffect,
} from 'vue'
import { paperEntries } from './data/papers.generated'

const allVersionsLabel = '全部卷别'
const allSubjectsLabel = '全部学科'

const activeVersion = ref(allVersionsLabel)
const activeSubject = ref(allSubjectsLabel)
const activePaperId = ref(paperEntries[0]?.id ?? '')
const readerFrame = ref<HTMLIFrameElement | null>(null)
const readerSurface = ref<HTMLElement | null>(null)
const isImmersive = ref(false)

const versionOptions = computed(() => [
  allVersionsLabel,
  ...new Set(paperEntries.map((paper) => paper.version)),
])

const subjectOptions = computed(() => {
  const scopedPapers =
    activeVersion.value === allVersionsLabel
      ? paperEntries
      : paperEntries.filter((paper) => paper.version === activeVersion.value)

  return [allSubjectsLabel, ...new Set(scopedPapers.map((paper) => paper.subject))]
})

const filteredPapers = computed(() =>
  paperEntries.filter((paper) => {
    const matchesVersion =
      activeVersion.value === allVersionsLabel || paper.version === activeVersion.value
    const matchesSubject =
      activeSubject.value === allSubjectsLabel || paper.subject === activeSubject.value

    return matchesVersion && matchesSubject
  }),
)

const selectedPaper = computed(
  () => filteredPapers.value.find((paper) => paper.id === activePaperId.value) ?? null,
)

const selectedPaperIndex = computed(() =>
  filteredPapers.value.findIndex((paper) => paper.id === activePaperId.value),
)

const previousPaper = computed(() => {
  if (selectedPaperIndex.value <= 0) {
    return null
  }

  return filteredPapers.value[selectedPaperIndex.value - 1] ?? null
})

const nextPaper = computed(() => {
  if (selectedPaperIndex.value < 0) {
    return null
  }

  return filteredPapers.value[selectedPaperIndex.value + 1] ?? null
})

watch(subjectOptions, (options) => {
  if (!options.includes(activeSubject.value)) {
    activeSubject.value = allSubjectsLabel
  }
})

watch(
  filteredPapers,
  (papers) => {
    if (!papers.some((paper) => paper.id === activePaperId.value)) {
      activePaperId.value = papers[0]?.id ?? ''
    }
  },
  { immediate: true },
)

watch(selectedPaper, async () => {
  await nextTick()
  applyReaderTheme()
})

watchEffect(() => {
  const label = selectedPaper.value
    ? `${selectedPaper.value.version} - ${selectedPaper.value.subject} | 高考试卷档案馆`
    : '高考试卷档案馆'

  document.title = label
})

watch(isImmersive, (active) => {
  document.body.classList.toggle('reader-immersive', active)
})

onMounted(() => {
  applyReaderTheme()
  document.addEventListener('fullscreenchange', syncImmersiveState)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncImmersiveState)
  document.body.classList.remove('reader-immersive')
})

function selectPaper(paperId: string) {
  activePaperId.value = paperId
}

function goToPreviousPaper() {
  if (previousPaper.value) {
    activePaperId.value = previousPaper.value.id
  }
}

function goToNextPaper() {
  if (nextPaper.value) {
    activePaperId.value = nextPaper.value.id
  }
}

async function toggleImmersiveMode() {
  const host = readerSurface.value

  if (!host) {
    return
  }

  if (document.fullscreenElement === host) {
    await document.exitFullscreen()
    return
  }

  if (document.fullscreenElement && document.fullscreenElement !== host) {
    await document.exitFullscreen()
  }

  await host.requestFullscreen()
}

function syncImmersiveState() {
  isImmersive.value = document.fullscreenElement === readerSurface.value
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function countChineseCharacters(value: string) {
  return (value.match(/[\u4e00-\u9fff]/g) ?? []).length
}

function hasMathToken(value: string) {
  return /[=+\-−×÷/√∥⊥≤≥≈≠²³₀₁₂₃₄₅₆₇₈₉αβγλμπσ△∠]/.test(value)
}

function isEquationLike(value: string) {
  const compact = value.replace(/[()（）〔〕［］,.，。；：:\s]/g, '')

  if (!compact || !hasMathToken(compact)) {
    return false
  }

  const chineseCount = countChineseCharacters(compact)
  return (
    chineseCount <= Math.max(2, Math.floor(compact.length * 0.18)) ||
    /^[=+\-−×÷/√∥⊥≤≥≈≠]/.test(compact)
  )
}

function splitNarrativeAndEquation(value: string) {
  if (countChineseCharacters(value) < 6) {
    return null
  }

  const separators = ['所以', '则', '可得', '即', '故', '于是']

  for (const separator of separators) {
    const index = value.indexOf(separator)

    if (index <= 0) {
      continue
    }

    const lead = value.slice(0, index + separator.length).trim()
    const equation = value
      .slice(index + separator.length)
      .trim()
      .replace(/^[：:，,\s]+/, '')
      .replace(/[。；]\s*$/, '')

    if (equation && isEquationLike(equation)) {
      return { lead, equation }
    }
  }

  return null
}

function enhanceSolutionLayout(frameDocument: Document) {
  const solutions = frameDocument.querySelectorAll<HTMLElement>('.solution')

  solutions.forEach((solution) => {
    if (solution.dataset.enhanced === 'true') {
      return
    }

    solution.dataset.enhanced = 'true'

    const paragraphs = Array.from(solution.querySelectorAll<HTMLParagraphElement>('p'))

    paragraphs.forEach((paragraph, index) => {
      const text = normalizeText(paragraph.textContent ?? '')

      if (!text) {
        return
      }

      if (index === 0 && text.includes('参考解答')) {
        paragraph.classList.add('solution-heading')
        return
      }

      if (paragraph.children.length === 0) {
        const split = splitNarrativeAndEquation(text)

        if (split) {
          const leadParagraph = frameDocument.createElement('p')
          leadParagraph.className = 'solution-line'
          leadParagraph.textContent = split.lead

          const equationParagraph = frameDocument.createElement('p')
          equationParagraph.className = 'equation-line'
          equationParagraph.textContent = split.equation

          paragraph.replaceWith(leadParagraph, equationParagraph)
          return
        }
      }

      paragraph.classList.add(isEquationLike(text) ? 'equation-line' : 'solution-line')
    })
  })
}

function applyReaderTheme() {
  const frameDocument = readerFrame.value?.contentDocument

  if (!frameDocument) {
    return
  }

  const frameHead = frameDocument.head || frameDocument.getElementsByTagName('head')[0]

  if (!frameHead) {
    return
  }

  let styleNode = frameDocument.getElementById('gaokao-archive-theme')

  if (!styleNode) {
    styleNode = frameDocument.createElement('style')
    styleNode.id = 'gaokao-archive-theme'
    frameHead.appendChild(styleNode)
  }

  styleNode.textContent = `
    :root {
      color-scheme: light;
    }

    html {
      scroll-behavior: smooth;
      background: #eadfca;
    }

    body {
      position: relative;
      margin: 0 auto !important;
      max-width: 1100px !important;
      min-height: 100vh;
      padding: 72px clamp(20px, 3.5vw, 72px) 120px !important;
      background:
        radial-gradient(circle at top left, rgba(167, 49, 33, 0.08), transparent 34%),
        linear-gradient(180deg, #fdf8ef 0%, #f5eddf 100%) !important;
      color: #1f1814 !important;
      font: 400 17px/1.95 "Noto Sans SC", "Microsoft YaHei", sans-serif !important;
    }

    body::before {
      content: "GAOKAO PAPER";
      position: absolute;
      top: 28px;
      left: clamp(20px, 3.5vw, 72px);
      color: rgba(159, 42, 27, 0.76);
      font: 600 12px/1 "Noto Sans SC", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.24em;
    }

    h1, h2, h3 {
      color: #1d1511 !important;
      font-family: "Noto Serif SC", "STSong", serif !important;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: 0.03em;
    }

    h1 {
      margin-bottom: 1.2em !important;
      font-size: clamp(2.1rem, 4vw, 3rem) !important;
      text-align: left !important;
    }

    h2 {
      margin-top: 2.6em !important;
      padding-bottom: 0.45em !important;
      border-bottom: 1px solid rgba(79, 57, 46, 0.18) !important;
      font-size: clamp(1.3rem, 2vw, 1.7rem) !important;
    }

    h3 {
      margin-top: 1.8em !important;
      font-size: 1.15rem !important;
    }

    p {
      margin: 0.85em 0 !important;
    }

    .question {
      margin: 1.8rem 0 !important;
      padding: 0 0 1.6rem !important;
      border-bottom: 1px dashed rgba(79, 57, 46, 0.18);
    }

    .question strong:first-child {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2em;
      margin-right: 0.2em;
      color: #9f2a1b;
      font-family: "Noto Serif SC", "STSong", serif;
    }

    .options {
      margin: 0.95rem 0 0 1.2rem !important;
      color: #40332d;
      line-height: 1.9;
    }

    .answer {
      display: inline-block;
      margin-top: 0.9rem !important;
      padding: 0.2rem 0.8rem;
      border-radius: 999px;
      background: rgba(159, 42, 27, 0.09);
      color: #9f2a1b !important;
      font-weight: 700 !important;
      letter-spacing: 0.06em;
    }

    .solution {
      margin-top: 1.4rem !important;
      padding: 1.5rem 1.6rem !important;
      border: 1px solid rgba(159, 42, 27, 0.14) !important;
      border-left: 4px solid rgba(159, 42, 27, 0.46) !important;
      background:
        linear-gradient(180deg, rgba(255, 252, 247, 0.96), rgba(250, 243, 232, 0.92)) !important;
    }

    .solution-heading {
      margin: 0 0 1rem !important;
      color: #8d2618 !important;
      font-weight: 700 !important;
      letter-spacing: 0.08em;
    }

    .solution-line {
      margin: 0.7rem 0 !important;
      color: #2f241f !important;
    }

    .equation-line {
      width: fit-content;
      max-width: 100%;
      margin: 1.05rem auto !important;
      padding: 0.25rem 1.3rem !important;
      color: #1f1510 !important;
      background: linear-gradient(180deg, rgba(255, 250, 244, 0.95), rgba(248, 238, 225, 0.9));
      border-radius: 999px;
      font-family: "Noto Serif SC", "Times New Roman", serif !important;
      font-size: 1.28rem !important;
      font-weight: 600 !important;
      line-height: 1.9 !important;
      text-align: center !important;
      letter-spacing: 0.02em;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
    }

    .equation-line sub,
    .equation-line sup {
      font-size: 0.72em;
      line-height: 0;
    }

    table {
      width: 100%;
      margin: 1.2rem 0 !important;
      border-collapse: collapse;
      background: rgba(255, 255, 255, 0.55);
    }

    td, th {
      padding: 0.7rem 0.8rem !important;
      border: 1px solid rgba(79, 57, 46, 0.25) !important;
      text-align: center;
    }

    img {
      max-width: 100%;
      height: auto;
    }
  `

  enhanceSolutionLayout(frameDocument)
}
</script>

<template>
  <div class="page-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">CEE Archive</p>
        <h1>高考试卷档案馆</h1>
      </div>
      <p class="topbar-meta">共 {{ paperEntries.length }} 份试卷</p>
    </header>

    <section v-if="paperEntries.length > 0" class="filter-dock">
      <div class="filter-row">
        <span class="filter-label">卷别</span>
        <div class="tab-row">
          <button
            v-for="version in versionOptions"
            :key="version"
            type="button"
            class="filter-tab"
            :class="{ active: activeVersion === version }"
            @click="activeVersion = version"
          >
            {{ version }}
          </button>
        </div>
      </div>

      <div class="filter-row">
        <span class="filter-label">学科</span>
        <div class="tab-row">
          <button
            v-for="subject in subjectOptions"
            :key="subject"
            type="button"
            class="filter-tab"
            :class="{ active: activeSubject === subject }"
            @click="activeSubject = subject"
          >
            {{ subject }}
          </button>
        </div>
      </div>
    </section>

    <main v-if="paperEntries.length > 0" class="reader-layout">
      <section v-if="selectedPaper" ref="readerSurface" class="reader-surface">
        <header class="reader-header">
          <div class="reader-heading">
            <p class="eyebrow">试卷阅读</p>
            <h2>{{ selectedPaper.version }} / {{ selectedPaper.subject }}</h2>
            <p class="reader-path">{{ selectedPaper.relativePath }}</p>
          </div>

          <div class="reader-tools">
            <button
              type="button"
              class="reader-tool"
              :disabled="!previousPaper"
              @click="goToPreviousPaper"
            >
              上一份
            </button>
            <button
              type="button"
              class="reader-tool"
              :disabled="!nextPaper"
              @click="goToNextPaper"
            >
              下一份
            </button>
            <button type="button" class="reader-tool reader-tool-strong" @click="toggleImmersiveMode">
              {{ isImmersive ? '退出沉浸' : '沉浸全屏' }}
            </button>
            <a
              class="reader-tool"
              :href="selectedPaper.archiveUrl"
              target="_blank"
              rel="noreferrer"
            >
              原始 HTML
            </a>
          </div>
        </header>

        <div v-if="filteredPapers.length > 1" class="reader-strip">
          <div class="reader-strip-meta">
            <span>当前筛选</span>
            <strong>{{ filteredPapers.length }} 份</strong>
          </div>

          <div class="paper-row">
            <button
              v-for="paper in filteredPapers"
              :key="paper.id"
              type="button"
              class="paper-pill"
              :class="{ active: selectedPaper.id === paper.id }"
              @click="selectPaper(paper.id)"
            >
              <span>{{ paper.subject }}</span>
              <small>{{ paper.version }}</small>
            </button>
          </div>
        </div>

        <div class="reader-stage">
          <div class="reader-stage-head">
            <span>{{ selectedPaper.subject }}</span>
            <span>{{ selectedPaper.version }}</span>
            <span v-if="isImmersive">按 Esc 退出沉浸模式</span>
          </div>

          <div class="reader-frame-wrap">
            <Transition name="reader-fade" mode="out-in">
              <iframe
                v-if="selectedPaper"
                :key="selectedPaper.id"
                ref="readerFrame"
                class="reader-frame"
                :src="selectedPaper.archiveUrl"
                :title="`${selectedPaper.version} ${selectedPaper.subject}`"
                @load="applyReaderTheme"
              />
            </Transition>
          </div>
        </div>
      </section>

      <section v-else class="empty-panel">
        <p>当前筛选条件下没有可展示的试卷。</p>
      </section>
    </main>

    <section v-else class="empty-panel empty-panel-full">
      <p class="eyebrow">暂无试卷</p>
      <h2>没有扫描到可用的 HTML 试卷文件。</h2>
      <p>
        把数据放到 <code>data/papers</code>，或设置环境变量
        <code>PAPER_SOURCE_DIR</code> 后运行 <code>npm run sync:papers</code>。
      </p>
    </section>
  </div>
</template>
