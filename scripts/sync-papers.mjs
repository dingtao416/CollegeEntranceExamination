import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const defaultSourceRoot = path.join(projectRoot, 'data', 'papers')
const sourceRoot = process.env.PAPER_SOURCE_DIR || defaultSourceRoot
const archiveRoot = path.join(projectRoot, 'public', 'archive')
const outputFile = path.join(projectRoot, 'src', 'data', 'papers.generated.ts')

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        return walk(fullPath)
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        return [fullPath]
      }

      return []
    }),
  )

  return files.flat()
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function escapeText(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

async function generate() {
  await mkdir(path.dirname(outputFile), { recursive: true })
  await rm(archiveRoot, { recursive: true, force: true })
  await mkdir(archiveRoot, { recursive: true })

  let paperFiles = []

  try {
    paperFiles = await walk(sourceRoot)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[sync-papers] Unable to scan "${sourceRoot}": ${message}`)
  }

  paperFiles.sort((left, right) => left.localeCompare(right, 'zh-CN'))

  const paperEntries = []

  for (const [index, filePath] of paperFiles.entries()) {
    const relativePath = toPosix(path.relative(sourceRoot, filePath))
    const segments = relativePath.split('/')
    const subject = path.basename(filePath, '.html')
    const version = segments.length > 1 ? segments[segments.length - 2] : '未分类'
    const collection = segments.slice(0, -1).join(' / ') || '未分类'
    const fileName = `paper-${String(index + 1).padStart(3, '0')}.html`
    const archiveUrl = `/archive/${fileName}`
    const outputPath = path.join(archiveRoot, fileName)

    await copyFile(filePath, outputPath)

    paperEntries.push({
      id: `paper-${String(index + 1).padStart(3, '0')}`,
      version,
      subject,
      collection,
      relativePath,
      sourcePath: toPosix(path.relative(projectRoot, filePath)),
      archiveUrl,
    })
  }

  const lines = [
    "import type { PaperEntry } from '../types/paper'",
    '',
    'export const paperEntries: PaperEntry[] = [',
    ...paperEntries.map(
      (entry) =>
        `  { id: '${escapeText(entry.id)}', version: '${escapeText(entry.version)}', subject: '${escapeText(entry.subject)}', collection: '${escapeText(entry.collection)}', relativePath: '${escapeText(entry.relativePath)}', sourcePath: '${escapeText(entry.sourcePath)}', archiveUrl: '${escapeText(entry.archiveUrl)}' },`,
    ),
    ']',
    '',
  ]

  await writeFile(outputFile, lines.join('\n'), 'utf8')
  console.log(`[sync-papers] Synced ${paperEntries.length} paper file(s) from ${sourceRoot}`)
}

generate().catch((error) => {
  console.error('[sync-papers] Failed to generate paper manifest.')
  console.error(error)
  process.exitCode = 1
})
