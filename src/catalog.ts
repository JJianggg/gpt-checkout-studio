export type CountryOption = {
  code: string
  currency: string
  flag: string
  name: string
}

export type PlanOption = {
  id: string
  name: string
  priceHint: string
  description: string
  badge?: string
}

export const COUNTRIES: CountryOption[] = [
  { code: 'PH', currency: 'PHP', flag: '🇵🇭', name: '菲律宾' },
  { code: 'US', currency: 'USD', flag: '🇺🇸', name: '美国' },
  { code: 'JP', currency: 'JPY', flag: '🇯🇵', name: '日本' },
  { code: 'SG', currency: 'SGD', flag: '🇸🇬', name: '新加坡' },
  { code: 'KR', currency: 'KRW', flag: '🇰🇷', name: '韩国' },
  { code: 'IN', currency: 'INR', flag: '🇮🇳', name: '印度' },
  { code: 'ID', currency: 'IDR', flag: '🇮🇩', name: '印度尼西亚' },
  { code: 'BR', currency: 'BRL', flag: '🇧🇷', name: '巴西' },
  { code: 'GB', currency: 'GBP', flag: '🇬🇧', name: '英国' },
  { code: 'DE', currency: 'EUR', flag: '🇩🇪', name: '德国' },
  { code: 'TR', currency: 'TRY', flag: '🇹🇷', name: '土耳其' },
  { code: 'VN', currency: 'VND', flag: '🇻🇳', name: '越南' },
]

export const PLANS: PlanOption[] = [
  {
    id: 'chatgptplusplan',
    name: 'ChatGPT Plus',
    priceHint: 'Plus',
    description: '标准个人订阅档位',
  },
  {
    id: 'chatgptprolite',
    name: 'ChatGPT Pro Lite',
    priceHint: '5×',
    description: '更高使用额度，具体权益以结账页为准',
    badge: '推荐',
  },
  {
    id: 'chatgptpro',
    name: 'ChatGPT Pro',
    priceHint: '20×',
    description: '高额度个人订阅档位',
  },
]
