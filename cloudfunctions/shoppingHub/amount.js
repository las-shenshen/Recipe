const chineseDigits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function parseChineseNumber(value) {
  if (value === '半' || value === '一半') return 0.5
  let total = 0
  let section = 0
  let digit = 0
  for (const char of value) {
    if (Object.prototype.hasOwnProperty.call(chineseDigits, char)) {
      digit = chineseDigits[char]
    } else if (char === '十' || char === '百' || char === '千') {
      const unit = char === '十' ? 10 : char === '百' ? 100 : 1000
      section += (digit || 1) * unit
      digit = 0
    } else if (char === '万') {
      total += (section + digit || 1) * 10000
      section = 0
      digit = 0
    }
  }
  return total + section + digit
}

function parseAmount(amount) {
  const text = String(amount || '').trim()
  const match = text.match(/^(\d+\/\d+|\d+(?:\.\d+)?|一半|半|[零〇一二两三四五六七八九十百千万]+)\s*(.*)$/)
  if (!match) return null
  let value
  if (match[1].includes('/')) {
    const parts = match[1].split('/').map(Number)
    if (!parts[1]) return null
    value = parts[0] / parts[1]
  } else if (/^\d/.test(match[1])) {
    value = Number(match[1])
  } else {
    value = parseChineseNumber(match[1])
  }
  if (!Number.isFinite(value)) return null
  return { value, unit: match[2].trim() }
}

function formatNumber(value) {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function scaleAmount(amount, sets) {
  const count = Math.max(1, Number(sets) || 1)
  if (count === 1) return String(amount || '适量')
  const parsed = parseAmount(amount)
  if (!parsed) return `${amount || '适量'} × ${count}`
  const value = formatNumber(parsed.value * count)
  return `${value}${parsed.unit ? ` ${parsed.unit}` : ''}`
}

function aggregateAmounts(items) {
  if (!items.length) return { amount: '', note: '' }
  if (items.length === 1) return { amount: items[0].amount || '适量', note: '' }
  const parsed = items.map(item => parseAmount(item.amount))
  const unit = parsed[0] && parsed[0].unit
  if (parsed.every(item => item && item.unit === unit)) {
    const total = parsed.reduce((sum, item) => sum + item.value, 0)
    return { amount: `${formatNumber(total)}${unit ? ` ${unit}` : ''}`, note: '' }
  }
  return {
    amount: '按菜谱分别准备',
    note: items.map(item => `${item.recipeName || '手动添加'}：${item.amount || '适量'}`).join(' · ')
  }
}

module.exports = { parseAmount, scaleAmount, aggregateAmounts }
