// Reading what the advisor types ("4 215/55r16 road hazard warranty above 40k")
// into the comparison's number of tires, size and filters. Plain rules, no AI
// service: free, instant, and it lists what it couldn't place instead of
// guessing. No database access here, so every rule can be tested directly.
import { noFilters, type LoadLevel, type TireFilters } from './comparison.js'

export type TireRequest = {
  quantity: number | null
  size: string | null
  axle: 'front' | 'rear' | null
  filters: TireFilters
  // What it read, in shop words: "4 tires", "215/55R16", "road hazard".
  understood: string[]
  // Words it couldn't place, so the advisor knows to set those by hand.
  unread: string[]
}

const plyToLoad: Record<number, LoadLevel> = { 6: 'C', 8: 'D', 10: 'E', 12: 'F', 14: 'F' }
const loadWords: Record<LoadLevel, string> = {
  SL: 'standard load',
  XL: 'XL or stronger',
  C: 'load C or more',
  D: 'load D or more',
  E: 'load E or more',
  F: 'load F',
}
const numberWords: Record<string, number> = { one: 1, single: 1, two: 2, pair: 2, both: 2, four: 4, five: 5, six: 6 }

// Filler that carries no meaning on its own ("with", "warranty above").
const filler = new Set(
  (
    'a an and the with w w/ for of on in to at or than by from + & - , . $ ' +
    'tire tires tyre tyres need needs want wants looking customer cust has have i we he she they some new ' +
    'please pls quote me give get show options option size sizes car truck suv van his her their ' +
    'warranty warranties mileage miles mile mi above over least min minimum plus more better ' +
    'cheap cheapest budget good best price priced around about each ea per tread life rated rating ' +
    'set sets load range lr ply all set'
  ).split(' '),
)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `brands`: the catalog's brands, so "milestar" comes back as "Milestar".
// `currentQuantity`: used to turn a total budget into a per-tire price.
export function readTireRequest(text: string, brands: string[], currentQuantity = 4): TireRequest {
  let s = ` ${text.toLowerCase().replace(/[“”"]/g, ' ')} `
  const found: { at: number; label: string }[] = []
  const filters: TireFilters = { ...noFilters, brands: [] }
  let quantity: number | null = null
  let size: string | null = null
  let axle: 'front' | 'rear' | null = null
  let budget: { amount: number; total: boolean; at: number } | null = null

  // Runs a rule over the text; each match is blanked so later rules skip it.
  const take = (pattern: RegExp, use: (m: RegExpExecArray) => string | null) => {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const label = use(m)
      if (label === null) continue
      if (label) found.push({ at: m.index, label })
      s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length)
    }
  }

  // Sizes: 215/55R16, 215/55ZR16, 215 55 16, 2155516, LT245/75R16, 33x12.50R15.
  take(/\b(p|lt|st)?\s?(\d{3})\s?[/\s-]\s?(\d{2})\s?(?:z?r|[/\s-])\s?(\d{2})(?:\s?(lt))?\b/, (m) => {
    if (size) return null
    const prefix = (m[1] ?? (m[5] ? 'lt' : '')).replace('p', '').toUpperCase()
    size = `${prefix}${m[2]}/${m[3]}R${m[4]}`
    return size
  })
  take(/\b(p|lt|st)?(\d{3})(\d{2})z?r?(\d{2})\b/, (m) => {
    if (size) return null
    size = `${(m[1] ?? '').replace('p', '').toUpperCase()}${m[2]}/${m[3]}R${m[4]}`
    return size
  })
  take(/\b(\d{2})\s?x\s?(\d{1,2}(?:\.\d{1,2})?)\s?(?:z?r|[\s-])\s?(\d{2})(?:\s?lt)?\b/, (m) => {
    if (size) return null
    const width = m[2].includes('.') ? Number(m[2]).toFixed(2) : m[2]
    size = `${m[1]}X${width}R${m[3]}LT`
    return size
  })

  // Load: "load range e", "lre", "e rated", "10 ply", "xl", "extra load".
  const setLoad = (level: LoadLevel) => {
    filters.minLoad = level
    return loadWords[level]
  }
  take(/\b(?:load\s?range|lr)\s?([c-f])\b/, (m) => setLoad(m[1].toUpperCase() as LoadLevel))
  take(/\b([c-f])[\s-](?:range|rated|load)\b/, (m) => setLoad(m[1].toUpperCase() as LoadLevel))
  take(/\b(\d{1,2})\s?-?\s?(?:ply|pr)\b/, (m) => (plyToLoad[Number(m[1])] ? setLoad(plyToLoad[Number(m[1])]) : null))
  take(/\b(?:xl|extra[\s-]?load|reinforced)\b/, () => (filters.minLoad ? '' : setLoad('XL')))

  // Budget: "under $120", "max 120 each", "$600 total", "600 for all four".
  const totalWords = String.raw`(?:\s*(?:total|for (?:all|the set|the 4|the four|4|four|2|two|both)|all in|out the door|otd))`
  const eachWords = String.raw`(?:\s*(?:each|ea|a tire|per tire|apiece|a piece))`
  take(
    new RegExp(
      String.raw`(?:\b(?:under|below|max(?:imum)?|less than|no more than|up to|budget(?: of| is)?|around|about)\s*|<\s*)\$?\s*(\d{2,5}(?:\.\d{1,2})?)\b(${totalWords})?(${eachWords})?`,
    ),
    (m) => {
      budget = { amount: Number(m[1]), total: !!m[2], at: m.index }
      return ''
    },
  )
  take(
    new RegExp(String.raw`\$\s?(\d{2,5}(?:\.\d{1,2})?)\b(?:\s*(?:or less|or under|max|and under|tops))?(${totalWords})?(${eachWords})?`),
    (m) => {
      if (budget) return null
      budget = { amount: Number(m[1]), total: !!m[2], at: m.index }
      return ''
    },
  )

  // Warranty: "40k", "40k+", "50,000 miles", "60000 mi", "warranty 50".
  const setWarranty = (thousands: number) => {
    if (thousands < 20 || thousands > 120) return null
    filters.minWarranty = thousands * 1000
    return `${thousands}k+ warranty`
  }
  take(/\b(\d{2,3})\s?k\b\+?/, (m) => setWarranty(Number(m[1])))
  take(/\b(\d{2,3}),?000\b\+?(?:\s?(?:mi|miles?)\b)?/, (m) => setWarranty(Number(m[1])))
  take(/\bwarranty\s*(?:of|above|over|at least|min(?:imum)?|>|\+)?\s*(\d{2,3})\b/, (m) =>
    setWarranty(Number(m[1])),
  )

  take(/\b(?:road[\s-]?ha[sz]{1,2}ard|rh)\b/, () => {
    filters.roadHazard = true
    return 'road hazard'
  })

  // Season, then type. All-weather before all-season so neither eats the other.
  const setSeason = (season: string, label: string) => {
    filters.season = season
    return label
  }
  take(/\ball[\s-]?weather\b|\b3pmsf\b|\bsnowflake\b/, () => setSeason('all_weather', 'all-weather'))
  take(/\ball[\s-]?seasons?\b/, () => setSeason('all_season', 'all-season'))
  take(/\b(?:winter|snow)s?\b/, () => setSeason('winter', 'winter'))
  take(/\bsummers?\b/, () => setSeason('summer', 'summer'))

  const setType = (type: string, label: string) => {
    filters.tireType = type
    return label
  }
  take(/\ball[\s-]?terrains?\b|\ba\/t\b/, () => setType('all_terrain', 'all-terrain'))
  take(/\brugged[\s-]?terrains?\b|\br\/t\b/, () => setType('rugged_terrain', 'rugged-terrain'))
  take(/\bmud[\s-]?terrains?\b|\bm\/t\b|\bmudders?\b/, () => setType('mud_terrain', 'mud-terrain'))
  take(/\bhighway\b|\bh\/t\b/, () => setType('highway', 'highway'))
  take(/\btouring\b/, () => setType('touring', 'touring'))
  take(/\bperformance\b/, () => setType('performance', 'performance'))

  // Brands, longest first ("BF Goodrich" before "Goodrich"); spaces and dashes optional.
  for (const brand of [...brands].sort((a, b) => b.length - a.length)) {
    const words = brand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    if (words.length === 0) continue
    take(new RegExp(String.raw`\b${words.map(escape).join(String.raw`[\s-]*`)}\b`), () => {
      if (filters.brands.includes(brand)) return ''
      filters.brands.push(brand)
      return brand
    })
  }

  take(/\bfronts?\b/, () => {
    axle = 'front'
    return 'front'
  })
  take(/\b(?:rears?|backs?)\b/, () => {
    axle = 'rear'
    return 'rear'
  })

  // Number of tires, last, once sizes, prices and warranty are gone.
  const setQuantity = (n: number) => {
    if (quantity !== null || n < 1 || n > 8) return null
    quantity = n
    return `${n} tire${n === 1 ? '' : 's'}`
  }
  take(/\bset of (\d|four|two)\b/, (m) => setQuantity(Number(m[1]) || numberWords[m[1]]))
  take(/\b(?:full set|all four|all 4)\b/, () => setQuantity(4))
  take(/\b(?:a )?(one|single|two|pair|both|four|five|six)\b/, (m) => setQuantity(numberWords[m[1]]))
  take(/(?:\bx\s?([1-8])\b|\b([1-8])\s?x\b|(?<![\d.$])\b([1-8])\b(?![.\d]))/, (m) =>
    setQuantity(Number(m[1] ?? m[2] ?? m[3])),
  )

  if (budget) {
    const { amount, total, at } = budget as { amount: number; total: boolean; at: number }
    const count = quantity ?? currentQuantity
    filters.maxPrice = total ? Math.floor(amount / count) : amount
    found.push({
      at,
      label: total
        ? `up to $${filters.maxPrice} a tire ($${amount} ÷ ${count}, before install)`
        : `up to $${amount} a tire`,
    })
  }

  const unread = s
    .split(/\s+/)
    .map((w) => w.replace(/^[,.;:!?()]+|[,.;:!?()]+$/g, ''))
    .filter((w) => w && !filler.has(w))

  return {
    quantity,
    size,
    axle,
    filters,
    understood: found.sort((a, b) => a.at - b.at).map((f) => f.label),
    unread: [...new Set(unread)],
  }
}
