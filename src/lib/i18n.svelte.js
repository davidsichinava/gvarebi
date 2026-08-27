// English is the source of truth and is complete. In any other locale an empty
// string means untranslated and falls back to English, so a partly translated
// site degrades to readable rather than to blank.

import { getLocale } from './data.js'

const state = $state({ lang: 'en', dict: {}, fallback: {}, ready: false })

export async function setLocale(lang) {
  if (!Object.keys(state.fallback).length) state.fallback = await getLocale('en')
  state.dict = lang === 'en' ? state.fallback : await getLocale(lang)
  state.lang = lang
  state.ready = true
}

const interpolate = (s, vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s

/** Translate. Missing or empty values fall back to English, then to the key. */
export function t(key, vars) {
  const v = state.dict[key]
  const s = (typeof v === 'string' && v) || state.fallback[key] || key
  return interpolate(s, vars)
}

/** Pick the field for the active language — used for names that live in the data. */
export function name(obj) {
  return (state.lang === 'ka' ? obj?.name_ka : obj?.name_en) || obj?.name_en || obj?.name_ka || ''
}

export const i18n = state
