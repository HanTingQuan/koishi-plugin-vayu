import type { Context } from 'koishi'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import { $, Schema, sleep, Time } from 'koishi'
import { shortcut, stream } from 'koishi-plugin-montmorill'

export const name = 'vayu'

export interface Config {
  interval: number
  maxChunks: number
  punctBias: number
}

export const Config: Schema<Config> = Schema.object({
  interval: Schema.number().default(3 * Time.second).role('ms').description('间隔时间。'),
  maxChunks: Schema.number().default(5).description('最大分句数。'),
  punctBias: Schema.number().min(0).step(0.05).default(0.7).max(2).role('slider').description('标点偏好系数，小于1时鼓励在标点后断句，大于1时抑制。'),
})

declare module 'koishi' {
  interface Tables {
    vayus: {
      id: number
      vayu: string
      source: string
      answer: string
      desc: string
    }
  }
}

export const inject = ['database']

const SPACE = /\s+/

export function apply(ctx: Context, config: Config) {
  ctx.model.extend('vayus', {
    id: 'unsigned',
    vayu: 'char',
    source: 'string',
    answer: 'string',
    desc: 'string',
  })

  const jieba = Jieba.withDict(dict)

  ctx.command('vayu [id:number]', '从随蓝题库中出题')
    .alias('随蓝', '📘来一道随蓝')
    .option('interval', '-i <interval:number> 间隔时间（秒）')
    .action(async ({ options, session }, id?: number) => {
      if (!session)
        return

      const [vayu] = await ctx.database.select('vayus', id ? { id } : {})
        .orderBy($.random)
        .limit(1)
        .execute()
      if (!vayu)
        return '未找到符合条件的随蓝！'

      const description = vayu.desc.trim()
      const words = description.startsWith('1.')
        ? description.split(SPACE).map(word => `${word} `)
        : jieba.cut(description)

      const chunks = mergeChunks(words, config.maxChunks, config.punctBias)
      const interval = (options?.interval || 0) * 1000 || config.interval

      async function* generator(isDirect: boolean) {
        for (let index = 0; index < chunks.length; index++) {
          const chunk = chunks[index]

          if (index === 0)
            yield `${vayu.source}${shortcut.input(`/vayu.answer ${vayu.id} `, `#${vayu.id}`)}${vayu.vayu}${chunk}`
          else if (index === chunks.length - 1)
            return `${chunk}我读完了。\n> 再来一题 👉 ${shortcut(isDirect, '/vayu')}`
          else yield chunk

          await sleep(interval)
        }
      }

      await stream(session, generator(session.isDirect))
    })
    .subcommand('.answer <id:number> <answer:string>', '回答随蓝')
    .action(async ({ session }, id, answer) => {
      if (!session)
        return

      const [vayu] = await ctx.database.get('vayus', { id })
      if (!vayu)
        return '未找到符合条件的随蓝！'
      const correctAnswer = vayu.answer.split('/')
      if (!correctAnswer.includes(answer))
        return '❌️回答错误！'
      return '✅️回答正确！'
    })
}

const BAD_END = /^[\p{Ps}\p{Pi}]$/u
const BAD_START = /^[\p{Pe}\p{Pf}\p{Po}]$/u
const GOOD_SPLIT_END = BAD_START

function mergeChunks(words: string[], maxChunks: number, punctBias: number): string[] {
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
    if (idx <= 0 || idx >= n)
      return 1.0
    const prevLast = words[idx - 1].slice(-1)
    return GOOD_SPLIT_END.test(prevLast) ? punctBias : 1
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
