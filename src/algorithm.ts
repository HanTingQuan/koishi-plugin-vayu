const BAD_END = /^[\p{Ps}\p{Pi}]$/u
const BAD_START = /^[\p{Pe}\p{Pf}\p{Po}]$/u
const GOOD_SPLIT_END = BAD_START

export function mergeChunks(words: string[], maxChunks: number, punctBias: number): string[] {
  if (maxChunks <= 1)
    return [words.join('')]
  if (words.length <= maxChunks)
    return words.slice()
  const n = words.length

  const canSplitAt = (idx: number): boolean => {
    const prevLast = words[idx - 1].slice(-1)
    const nextFirst = words[idx].charAt(0)
    return !BAD_END.test(prevLast) && !BAD_START.test(nextFirst)
  }

  const splitBonus = (idx: number): number => {
    if (idx > 0 && idx < n) {
      const prevLast = words[idx - 1].slice(-1)
      if (GOOD_SPLIT_END.test(prevLast)) {
        return punctBias
      }
    }
    return 1.0
  }

  const lens = words.map(w => w.length)
  const prefixLen: number[] = Array.from<number>({ length: n + 1 }).fill(0)
  for (let i = 0; i < n; i++) prefixLen[i + 1] = prefixLen[i] + lens[i]
  const totalLen = prefixLen[n]

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from<number>({ length: maxChunks + 1 }).fill(Infinity))
  const choice: number[][] = Array.from({ length: n + 1 }, () => Array.from<number>({ length: maxChunks + 1 }).fill(-1))
  dp[0][0] = 0

  for (let k = 1; k <= maxChunks; k++) {
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        if (dp[j][k - 1] === Infinity)
          continue
        if (k > 1 && j > 0 && !canSplitAt(j))
          continue

        const len = prefixLen[i] - prefixLen[j]
        const remainingLen = totalLen - prefixLen[j]
        const remainingChunks = maxChunks - k + 1
        const dynamicTarget = remainingLen / remainingChunks

        let cost = Math.abs(len - dynamicTarget)
        cost *= splitBonus(j)

        const totalCost = dp[j][k - 1] + cost
        if (totalCost < dp[i][k]) {
          dp[i][k] = totalCost
          choice[i][k] = j
        }
      }
    }
  }

  if (dp[n][maxChunks] === Infinity) {
    for (let k = 1; k <= maxChunks; k++) {
      for (let i = k; i <= n; i++) {
        for (let j = k - 1; j < i; j++) {
          if (dp[j][k - 1] === Infinity)
            continue
          const len = prefixLen[i] - prefixLen[j]
          const remainingLen = totalLen - prefixLen[j]
          const remainingChunks = maxChunks - k + 1
          const dynamicTarget = remainingLen / remainingChunks
          const cost = Math.abs(len - dynamicTarget)
          const totalCost = dp[j][k - 1] + cost
          if (totalCost < dp[i][k]) {
            dp[i][k] = totalCost
            choice[i][k] = j
          }
        }
      }
    }
  }

  const chunks: string[] = []
  let cur = n
  for (let k = maxChunks; k > 0; k--) {
    const j = choice[cur][k]
    chunks.unshift(words.slice(j, cur).join(''))
    cur = j
  }
  return chunks
}
