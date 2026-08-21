import { parseArgs } from 'node:util'
import SREDBManager from '../utils/SREDBManager.js'
import DateUtils from '../utils/date.js'

const parseOptions = () => {
  const args = parseArgs({
    options: {
      verbose: { type: 'boolean', short: 'v', default: false },
      token: { type: 'string', short: 't' },
    },
    strict: false,
    allowNegative: true,
    allowPositionals: true,
  })
  const ret = args.values
  if (!ret.token) ret.token = process.env.SRE_DB_MGR_TOKEN
  if (!ret.token) throw Error('missing token')
  if (args.positionals.length === 1)
    ret.date = new Date(args.positionals[0])
  if (!ret.date || isNaN(ret.date.getTime()))
    ret.date = new Date(DateUtils['yyyy-MM-dd'](new Date()))
  return ret
}

export const { verbose, token, date } = parseOptions()

const parseUsers = (pack) => {
  const rows = pack?.rows
  if (!rows?.length) return []
  return rows.map(row => +row.uid).filter(n => !Number.isNaN(n))
}

const parseApiKeys = (pack) => {
  const rows = pack?.rows
  if (!rows?.length) return []
  return rows.map(row => row.api_key).filter(Boolean)
}

const parseVersions = (pack) => {
  const rows = pack?.rows
  if (!rows?.length) return []
  return rows.map(row => {
    return {
      version: row.version,
      count: +row.count,
    }
  })
}

const db = SREDBManager(token, { verbose })
const batchSize = 2500

const queryCoworkNew = async (date) => {
  const res = await db.query(
    'codesearch-prd-psql-readonly',
    `select distinct unity_id as uid from codesearch.users where unity_id is not null and created_at_utc >= '${date.toISOString()}' and created_at_utc < '${DateUtils.nextDay(date).toISOString()}'`
  )
  if (verbose) console.error(JSON.stringify(res))
  return parseUsers(res)
}

const queryCoworkActiveApiKey = async (date) => {
  const res = await db.query(
    'litellm-prd-psql-readonly',
    `select distinct api_key from "LiteLLM_SpendLogs" where "startTime" >= '${date.toISOString()}' and "startTime" < '${DateUtils.nextDay(date).toISOString()}' and api_key != '' group by api_key having sum(total_tokens) > 0`
  )
  if (verbose) console.error(JSON.stringify(res))
  return parseApiKeys(res)
}

const queryCoworkApiKeyUser = async (apiKeys) => {
  const ret = []
  for (let i = 0; i < apiKeys.length; i += batchSize) {
    const chunk = apiKeys.slice(i, i + batchSize)
    const res = await db.query(
      'codesearch-prd-psql-readonly',
      `select distinct u.unity_id as uid from codesearch.users u join codesearch.litellm_virtual_key k on u.id = k.user_id where k.litellm_key_hash in ${"('" + chunk.join("','") + "')"}`
    )
    if (verbose) console.error(JSON.stringify(res))
    ret.push(...parseUsers(res))
  }
  return [...new Set(ret)]
}

const queryCoworkActive = async (date) => {
  const apiKeys = await queryCoworkActiveApiKey(date)
  return await queryCoworkApiKeyUser(apiKeys)
}

const queryUser = async (date) => {
  const res = await db.query(
    'gen-p-prd-shard-30',
    `select distinct id as uid from userdata_v2.v2_user where created_time >= '${date.toISOString()}' and created_time < '${DateUtils.nextDay(date).toISOString()}'`
  )
  if (verbose) console.error(JSON.stringify(res))
  return parseUsers(res)
}

const queryTuanjieHubExisting = async (date) => {
  const res = await db.query(
    'gen-p-prd-shard-30',
    `select distinct owner_id as uid from oauth.view_access_token where split_part(user_id_client_id, ':', 2) = 'tuanjie_hub' and created_time >= '${date.toISOString()}' and created_time < '${DateUtils.nextDay(date).toISOString()}'`
  )
  if (verbose) console.error(JSON.stringify(res))
  return parseUsers(res)
}

const queryUnityHubExisting = async (date) => {
  const res = await db.query(
    'gen-p-prd-shard-30',
    `select distinct owner_id as uid from oauth.view_access_token where split_part(user_id_client_id, ':', 2) in ('unity_hub', 'launcher', 'activation') and created_time >= '${date.toISOString()}' and created_time < '${DateUtils.nextDay(date).toISOString()}'`
  )
  if (verbose) console.error(JSON.stringify(res))
  return parseUsers(res)
}

const queryTuanjieHub = async (date, uids) => {
  const ret = []
  for (let i = 0; i < uids.length; i += batchSize) {
    const chunk = uids.slice(i, i + batchSize)
    const res = await db.query(
      'gen-p-prd-shard-30',
      `select distinct owner_id as uid from oauth.view_access_token where split_part(user_id_client_id, ':', 2) = 'tuanjie_hub' and owner_id in ${'(' + chunk.join() + ')'} and created_time >= '${date.toISOString()}' and created_time < '${DateUtils.nextDay(date).toISOString()}'`
    )
    if (verbose) console.error(JSON.stringify(res))
    ret.push(...parseUsers(res))
  }
  return ret
}

const queryOldProject = async (date, uids) => {
  const ret = []
  for (let i = 0; i < uids.length; i += batchSize) {
    const chunk = uids.slice(i, i + batchSize)
    const res = await db.query(
      'volc-cdp-prd-starrocks-tuanjie_analytics',
      `select distinct genesis_user_id as uid from tuanjie_analytics.hub_ods_record where event_type = 'hub.projectOpen.v1' and event_timestamp >= ${date.getTime()} and event_timestamp < ${DateUtils.nextDay(date).getTime()} and genesis_user_id in ${'(' + chunk.join() + ')'}`
    )
    if (verbose) console.error(JSON.stringify(res))
    ret.push(...parseUsers(res))
  }
  return ret
}

const queryNewProject = async (date, uids) => {
  const ret = []
  for (let i = 0; i < uids.length; i += batchSize) {
    const chunk = uids.slice(i, i + batchSize)
    const res = await db.query(
      'volc-cdp-prd-starrocks-tuanjie_analytics',
      `select distinct genesis_user_id as uid from tuanjie_analytics.hub_ods_record where event_type = 'hub.projectNew.v2' and event_timestamp >= ${date.getTime()} and event_timestamp < ${DateUtils.nextDay(date).getTime()} and genesis_user_id in ${'(' + chunk.join() + ')'}`
    )
    if (verbose) console.error(JSON.stringify(res))
    ret.push(...parseUsers(res))
  }
  return ret
}

const queryNewProjectHubVersion = async (date, uids) => {
  const res = await db.query(
    'volc-cdp-prd-starrocks-tuanjie_analytics',
    `select hub_version as version, count(distinct genesis_user_id) as count from tuanjie_analytics.hub_ods_record where event_type = 'hub.projectNew.v2' and event_timestamp >= ${date.getTime()} and event_timestamp < ${DateUtils.nextDay(date).getTime()} and genesis_user_id in ${'(' + uids.join() + ')'} group by hub_version`
  )
  return parseVersions(res)
}

const queryCowork = async (date, uids) => {
  const ret = []
  for (let i = 0; i < uids.length; i += batchSize) {
    const chunk = uids.slice(i, i + batchSize)
    const res = await db.query(
      'gen-p-prd-shard-30',
      `select distinct owner_id as uid from oauth.view_access_token where split_part(user_id_client_id, ':', 2) = 'codely' and owner_id in ${'(' + chunk.join() + ')'} and created_time >= '${date.toISOString()}' and created_time < '${DateUtils.nextDay(date).toISOString()}'`
    )
    if (verbose) console.error(JSON.stringify(res))
    ret.push(...parseUsers(res))
  }
  return ret
}

const queryCoworkFromTuanjieHub = async (date, uids) => {
  const ret = []
  for (let i = 0; i < uids.length; i += batchSize) {
    const chunk = uids.slice(i, i + batchSize)
    const res = await db.query(
      'volc-cdp-prd-starrocks-tuanjie_analytics',
      `select distinct genesis_user_id as uid from tuanjie_analytics.hub_ods_record where event_type = 'hub.tuanjieAiOpen.v1' and event_timestamp >= ${date.getTime()} and event_timestamp < ${DateUtils.nextDay(date).getTime()} and genesis_user_id in ${'(' + chunk.join() + ')'}`
    )
    if (verbose) console.error(JSON.stringify(res))
    ret.push(...parseUsers(res))
  }
  return ret
}

const queryUnityHub = async (date, uids) => {
  const ret = []
  for (let i = 0; i < uids.length; i += batchSize) {
    const chunk = uids.slice(i, i + batchSize)
    const res = await db.query(
      'gen-p-prd-shard-30',
      `select distinct owner_id as uid from oauth.view_access_token where split_part(user_id_client_id, ':', 2) in ('unity_hub', 'launcher', 'activation') and owner_id in ${'(' + chunk.join() + ')'} and created_time >= '${date.toISOString()}' and created_time < '${DateUtils.nextDay(date).toISOString()}'`
    )
    if (verbose) console.error(JSON.stringify(res))
    ret.push(...parseUsers(res))
  }
  return ret
}

const queryToken = async (date, uids) => {
  const activeUids = await queryCoworkActive(date)
  return [...new Set(uids).intersection(new Set(activeUids))]
}

const query = async (date, result) => {
  if (!Array.isArray(result.user)) result.user = await queryUser(date)
  const users = result.user
  await Promise.all([
    (async () => { if (!Array.isArray(result.tuanjieHub)) result.tuanjieHub = await queryTuanjieHub(date, users) })(),
    (async () => { if (!Array.isArray(result.newProject)) result.newProject = await queryNewProject(date, users) })(),
    (async () => { if (!Array.isArray(result.oldProject)) result.oldProject = await queryOldProject(date, users) })(),
    (async () => { if (!Array.isArray(result.cowork)) result.cowork = await queryCowork(date, users) })(),
    (async () => { if (!Array.isArray(result.coworkFromTuanjieHub)) result.coworkFromTuanjieHub = await queryCoworkFromTuanjieHub(date, users) })(),
    (async () => { if (!Array.isArray(result.token)) result.token = await queryToken(date, users) })(),
    (async () => { if (!Array.isArray(result.unityHub)) result.unityHub = await queryUnityHub(date, users) })(),
  ])
  result.editor = [...new Set([...(result.oldProject || []), ...(result.newProject || [])])]
  await Promise.all([
    (async () => { if (!Array.isArray(result.newProjectCowork)) result.newProjectCowork = await queryCowork(date, result.newProject) })(),
    (async () => { if (!Array.isArray(result.newProjectToken)) result.newProjectToken = await queryToken(date, result.newProject) })(),
  ])

  const extra = result.extra
  const cowork = new Set(result.cowork || [])
  const editor = new Set(result.editor || [])
  const oldProject = new Set(result.oldProject || [])
  const newProject = new Set(result.newProject || [])
  const tuanjieHub = new Set(result.tuanjieHub || [])
  const coworkFromTuanjieHub = new Set(result.coworkFromTuanjieHub || [])
  extra.cowork_inter_editor = [...cowork.intersection(editor)]
  extra.cowork_diff_editor = [...cowork.difference(editor)]
  extra.cowork_inter_oldProject = [...cowork.intersection(oldProject)]
  extra.cowork_diff_oldProject = [...cowork.difference(oldProject)]
  extra.cowork_inter_newProject = [...cowork.intersection(newProject)]
  extra.cowork_diff_newProject = [...cowork.difference(newProject)]
  extra.cowork_inter_tuanjieHub = [...cowork.intersection(tuanjieHub)]
  extra.cowork_diff_tuanjieHub = [...cowork.difference(tuanjieHub)]
  extra.cowork_diff_editor_diff_coworkFromTuanjieHub = [...cowork.difference(editor).difference(coworkFromTuanjieHub)]

  return result
}

const proto = {
  date: DateUtils['yyyy-MM-dd'](date),
  user: null,
  active: null,
  tuanjieHub: null,
  activeTuanjieHub: null,
  editor: null,
  newProject: null,
  oldProject: null,
  cowork: null,
  coworkFromTuanjieHub: null,
  token: null,
  unityHub: null,
  newProjectCowork: null,
  newProjectToken: null,
  extra: {},
}

const simplify = (obj) => {
  if (typeof obj !== 'object' || obj === null)
    return obj
  if (Array.isArray(obj))
    return obj.length
  const result = {}
  for (const [key, value] of Object.entries(obj)) {
    const r = simplify(value)
    if (r !== null)
      result[key] = r
  }
  return result
}

export default async (date) => {
  const full = {
    newUser: structuredClone(proto),
    tuanjieHub: structuredClone(proto),
    newTuanjieHub: structuredClone(proto),
    newUnityHub: structuredClone(proto),
    cowork: structuredClone(proto),
    newCowork: structuredClone(proto),
  }
  const lite = structuredClone(full)
  lite.newUser = simplify(await query(date, full.newUser))

  full.tuanjieHub.user = full.tuanjieHub.tuanjieHub = await queryTuanjieHubExisting(date)
  lite.tuanjieHub = simplify(await query(date, full.tuanjieHub))

  await Promise.all([
    (async () => {
      full.newTuanjieHub.user = full.newUser.tuanjieHub
      await Promise.all([
        (async () => { full.newTuanjieHub.cowork = await queryCowork(date, full.newTuanjieHub.user) })(),
        (async () => { full.newTuanjieHub.token = await queryToken(date, full.newTuanjieHub.user) })(),
      ])
      lite.newTuanjieHub = simplify(full.newTuanjieHub)
    })(),
    (async () => {
      full.newUnityHub.user = full.newUser.unityHub
      await Promise.all([
        (async () => { full.newUnityHub.cowork = await queryCowork(date, full.newUnityHub.user) })(),
        (async () => { full.newUnityHub.token = await queryToken(date, full.newUnityHub.user) })(),
      ])
      lite.newUnityHub = simplify(full.newUnityHub)
    })(),
    (async () => {
      full.cowork.user = await queryCoworkActive(date)
      full.cowork.tuanjieHub = await queryTuanjieHub(date, full.cowork.user)
      full.cowork.unityHub = await queryUnityHub(date, full.cowork.user)
      lite.cowork = simplify(full.cowork)
    })(),
    (async () => {
      full.newCowork.user = await queryCoworkNew(date)
      full.newCowork.tuanjieHub = await queryTuanjieHub(date, full.newCowork.user)
    })(),
  ])
  full.newCowork.active = [...new Set(full.cowork.user).intersection(new Set(full.newCowork.user))]
  full.newCowork.activeTuanjieHub = await queryTuanjieHub(date, full.newCowork.active)
  lite.newCowork = simplify(full.newCowork)

  return { full, lite }
}

