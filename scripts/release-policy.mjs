export function qualityPassed(runs, sha) {
  const matching = runs.filter(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push').sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)
  return matching[0]?.conclusion === 'success'
}
export function versionMatches(version, sha) {
  return version?.gitSha === sha && version?.environment === 'production'
}
export function compatibleBuild(builds, hash) {
  return /^[a-f0-9]{40,64}$/.test(hash) && builds.some(build => build.status === 'FINISHED' && build.platform === 'ANDROID' && build.channel === 'production' && build.runtimeVersion === hash)
}

export function parseEasJson(output) {
  const start = output.search(/^[\[{]/m)
  if (start < 0) throw new Error('EAS returned no JSON output.')
  return JSON.parse(output.slice(start))
}
