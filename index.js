const os = require('os')
const fs = require('fs')
const path = require('path')
const core = require('@actions/core')
const exec = require('@actions/exec')
const cache = require('@actions/cache')
const common = require('./common')

const windows = common.windows

const inputDefaults = {
  'architecture': 'x64',
  'ruby-version': 'default',
  'bundler': 'default',
  'bundler-cache': 'true',
  'working-directory': '.',
}

// entry point when this action is run on its own
export async function run() {
  try {
    await setupRuby()
  } catch (error) {
    core.setFailed(error.message)
  }
}

// entry point when this action is run from other actions
export async function setupRuby(options = {}) {
  const inputs = { ...options }
  for (const key in inputDefaults) {
    if (!Object.prototype.hasOwnProperty.call(inputs, key)) {
      inputs[key] = core.getInput(key) || inputDefaults[key]
    }
  }

  process.chdir(inputs['working-directory'])

  const platform = common.getVirtualEnvironmentName()
  const [engine, parsedVersion] = parseRubyEngineAndVersion(inputs['ruby-version'])
  const architecture = inputs['architecture']

  if (architecture !== 'x64' && architecture !== 'x86' && architecture !== 'default') {
    throw new Error(`Invalid architecture: ${architecture}`);
  }

  let installer
  if (platform.startsWith('windows-') && engine === 'ruby') {
    installer = require('./windows')
  } else {
    installer = require('./ruby-builder')
  }

  const engineVersions = installer.getAvailableVersions(platform, engine, architecture)
  const version = validateRubyEngineAndVersion(platform, engineVersions, engine, parsedVersion)

  envPreInstall(platform, engine)

  // JRuby can use compiled extension code, so make sure gcc exists.
  // As of Jan-2022, JRuby compiles against msvcrt.
  if (platform.startsWith('windows') && (engine === 'jruby') &&
    !fs.existsSync('C:\\msys64\\mingw64\\bin\\gcc.exe')) {
    await require('./windows').installJRubyTools()
  }

  const rubyPrefix = await installer.install(platform, engine, architecture, version)

  await createGemRC(rubyPrefix)

  // When setup-ruby is used by other actions, this allows code in them to run
  // before 'bundle install'.  Installed dependencies may require additional
  // libraries & headers, build tools, etc.
  if (inputs['afterSetupPathHook'] instanceof Function) {
    await inputs['afterSetupPathHook']({ platform, rubyPrefix, engine, version })
  }

  if (inputs['bundler'] !== 'none') {
    const [gemfile, lockFile] = detectGemfiles()

    const bundlerVersion = await common.measure('Installing Bundler', async () =>
      installBundler(inputs['bundler'], lockFile, platform, rubyPrefix, engine, version))

    if (inputs['bundler-cache'] === 'true') {
      await common.measure('bundle install', async () =>
          bundleInstall(gemfile, lockFile, platform, engine, architecture, version, bundlerVersion))
    }
  }

  core.setOutput('ruby-prefix', rubyPrefix)
}

// The returned gemfile is guaranteed to exist, the lockfile might not exist
function detectGemfiles() {
  const gemfilePath = process.env['BUNDLE_GEMFILE'] || 'Gemfile'
  if (fs.existsSync(gemfilePath)) {
    return [gemfilePath, `${gemfilePath}.lock`]
  } else if (process.env['BUNDLE_GEMFILE']) {
    throw new Error(`$BUNDLE_GEMFILE is set to ${gemfilePath} but does not exist`)
  }

  if (fs.existsSync("gems.rb")) {
    return ["gems.rb", "gems.locked"]
  }

  return [null, null]
}

function parseRubyEngineAndVersion(rubyVersion) {
  if (rubyVersion === 'default') {
    if (fs.existsSync('.ruby-version')) {
      rubyVersion = '.ruby-version'
    } else if (fs.existsSync('.tool-versions')) {
      rubyVersion = '.tool-versions'
    } else {
      throw new Error('input ruby-version needs to be specified if no .ruby-version or .tool-versions file exists')
    }
  }

  if (rubyVersion === '.ruby-version') { // Read from .ruby-version
    rubyVersion = fs.readFileSync('.ruby-version', 'utf8').trim()
    console.log(`Using ${rubyVersion} as input from file .ruby-version`)
  } else if (rubyVersion === '.tool-versions') { // Read from .tool-versions
    const toolVersions = fs.readFileSync('.tool-versions', 'utf8').trim()
    const rubyLine = toolVersions.split(/\r?\n/).filter(e => e.match(/^ruby\s/))[0]
    rubyVersion = rubyLine.match(/^ruby\s+(.+)$/)[1]
    console.log(`Using ${rubyVersion} as input from file .tool-versions`)
  }

  let engine, version
  if (rubyVersion.match(/^(\d+)/) || common.isHeadVersion(rubyVersion)) { // X.Y.Z => ruby-X.Y.Z
    engine = 'ruby'
    version = rubyVersion
  } else if (!rubyVersion.includes('-')) { // myruby -> myruby-stableVersion
    engine = rubyVersion
    version = '' // Let the logic in validateRubyEngineAndVersion() find the version
  } else { // engine-X.Y.Z
    [engine, version] = common.partition(rubyVersion, '-')
  }

  return [engine, version]
}

function validateRubyEngineAndVersion(platform, engineVersions, engine, parsedVersion) {
  if (!engineVersions) {
    throw new Error(`Unknown engine ${engine} on ${platform}`)
  }

  let version = parsedVersion
  if (!engineVersions.includes(parsedVersion)) {
    const latestToFirstVersion = engineVersions.slice().reverse()
    // Try to match stable versions first, so an empty version (engine-only) matches the latest stable version
    let found = latestToFirstVersion.find(v => common.isStableVersion(v) && v.startsWith(parsedVersion))
    if (!found) {
      // Exclude head versions, they must be exact matches
      found = latestToFirstVersion.find(v => !common.isHeadVersion(v) && v.startsWith(parsedVersion))
    }

    if (found) {
      version = found
    } else {
      throw new Error(`Unknown version ${parsedVersion} for ${engine} on ${platform}
        available versions for ${engine} on ${platform}: ${engineVersions.join(', ')}
        File an issue at https://github.com/ruby/setup-ruby/issues if would like support for a new version`)
    }
  }

  return version
}

async function createGemRC(rubyPrefix) {
  const gemrc = path.join(os.homedir(), '.gemrc')
  if (!fs.existsSync(gemrc)) {
    fs.writeFileSync(gemrc, `gem: --${await gemIsV2OrLater(rubyPrefix) ? 'no-document' : 'no-rdoc --no-ri'}${os.EOL}`)
  }
}

// sets up ENV variables
function envPreInstall(platform, engine) {
  const ENV = process.env
  if (windows) {
    // puts normal Ruby temp folder on SSD
    core.exportVariable('TMPDIR', ENV['RUNNER_TEMP'])
    // bash - sets home to match native windows, normally C:\Users\<user name>
    core.exportVariable('HOME', ENV['HOMEDRIVE'] + ENV['HOMEPATH'])
    // bash - needed to maintain Path from Windows
    core.exportVariable('MSYS2_PATH_TYPE', 'inherit')
  } else if (engine === 'jruby') {
    if (platform === 'ubuntu-24.04') {
      // Use Java 11 for compatibility.
      setJavaHome(ENV['JAVA_HOME_11_X64'])
    } else if (platform.startsWith('macos-')) {
      // Use an older version of Java for compatibility.
      // macos-12 defaults to Java 8. Use Java 11 if 8 isn't available.
      // macos-14 runs on arm (and doesn't include Java 8).
      const javaHome = ENV['JAVA_HOME_8_X64'] || ENV['JAVA_HOME_11_X64'] || ENV['JAVA_HOME_11_arm64']
      if (javaHome) setJavaHome(javaHome)
    }
  }
}

function setJavaHome(javaHome) {
  core.info(`Setting JAVA_HOME=${javaHome}`)
  core.exportVariable('JAVA_HOME', javaHome)
}

function readBundledWithFromGemfileLock(lockFile) {
  if (lockFile !== null && fs.existsSync(lockFile)) {
    const contents = fs.readFileSync(lockFile, 'utf8')
    const lines = contents.split(/\r?\n/)
    const bundledWithLine = lines.findIndex(line => /^BUNDLED WITH$/.test(line.trim()))
    if (bundledWithLine !== -1) {
      const nextLine = lines[bundledWithLine+1]
      if (nextLine && /^\d+/.test(nextLine.trim())) {
        const bundlerVersion = nextLine.trim()
        console.log(`Using Bundler ${bundlerVersion} from ${lockFile} BUNDLED WITH ${bundlerVersion}`)
        return bundlerVersion
      }
    }
  }
  return null
}

async function installBundler(bundlerVersionInput, lockFile, platform, rubyPrefix, engine, rubyVersion) {
  let bundlerVersion = bundlerVersionInput

  if (bundlerVersion === 'default' || bundlerVersion === 'Gemfile.lock') {
    bundlerVersion = readBundledWithFromGemfileLock(lockFile)

    if (!bundlerVersion) {
      bundlerVersion = 'latest'
    }
  }

  if (bundlerVersion === 'latest') {
    bundlerVersion = '2'
  }

  if (/^\d+/.test(bundlerVersion)) {
    // OK
  } else {
    throw new Error(`Cannot parse bundler input: ${bundlerVersion}`)
  }

  if (engine === 'ruby' && rubyVersion.match(/^(1\.|2\.[012])/)) {
    console.log('Bundler 2 requires Ruby 2.3+, using Bundler 1 on Ruby <= 2.2')
    bundlerVersion = '1'
  } else if (engine === 'ruby' && rubyVersion.startsWith('2.3')) {
    console.log('Ruby 2.3 has a bug with Bundler 2 (https://github.com/rubygems/rubygems/issues/3570), using Bundler 1 instead on Ruby 2.3')
    bundlerVersion = '1'
  } else if (engine === 'jruby' && rubyVersion.match(/^(1\.|9\.[01]\.)/)) { // JRuby < 9.2 requires Bundler 1.
    console.log('JRuby < 9.2 requires Bundler 1')
    bundlerVersion = '1'
  }

  if (common.isHeadVersion(rubyVersion) && common.isBundler2Default(engine, rubyVersion) && bundlerVersion.startsWith('2')) {
    console.log(`Using Bundler 2 shipped with ${engine}-${rubyVersion}`)
  } else if (engine === 'truffleruby' && !common.isHeadVersion(rubyVersion) && bundlerVersion.startsWith('1')) {
    console.log(`Using Bundler 1 shipped with ${engine}`)
  } else {
    const gem = path.join(rubyPrefix, 'bin', 'gem')
    const args = ['install', 'bundler', '-v', `~> ${bundlerVersion}`, '--force']

    if (engine === 'jruby' && rubyVersion.match(/^9\.2\./)) {
      console.log('JRuby 9.2 requires a maximum of Bundler 2.3')
      args.push('-v', '< 2.4')
    }

    if (await gemIsV2OrLater(rubyPrefix)) {
      args.push('--no-document')
    } else {
      args.push('--no-rdoc', '--no-ri')
    }
    if (rubyVersion.startsWith('1.8.7')) {
      // Don't overwrite the patched copy of bundler (enabling SSL SNI) included in the package.
      args.push('--conservative')
    }
    await exec.exec(gem, args)
  }

  return bundlerVersion
}

async function gemIsV2OrLater(rubyPrefix) {
  const gem = path.join(rubyPrefix, 'bin', 'gem')
  let output = ''
  const options = {
    listeners: {
      stdout: (data) => {
        output += data.toString()
      }
    }
  }
  await exec.exec(gem, ['-v'], options)
  return !output.match(/^[01]\./)
}


async function bundleInstall(gemfile, lockFile, platform, engine, architecture, rubyVersion, bundlerVersion) {
  if (gemfile === null) {
    console.log('Could not determine gemfile path, skipping "bundle install" and caching')
    return false
  }

  let envOptions = {}
  if (bundlerVersion.startsWith('1') && common.isBundler2Default(engine, rubyVersion)) {
    // If Bundler 1 is specified on Rubies which ship with Bundler 2,
    // we need to specify which Bundler version to use explicitly until the lockfile exists.
    console.log(`Setting BUNDLER_VERSION=${bundlerVersion} for "bundle config|lock" commands below to ensure Bundler 1 is used`)
    envOptions = { env: { ...process.env, BUNDLER_VERSION: bundlerVersion } }
  }

  // config
  const cachePath = 'vendor/bundle'
  // An absolute path, so it is reliably under $PWD/vendor/bundle, and not relative to the gemfile's directory
  const bundleCachePath = path.join(process.cwd(), cachePath)

  await exec.exec('bundle', ['config', '--local', 'path', bundleCachePath], envOptions)

  if (fs.existsSync(lockFile)) {
    await exec.exec('bundle', ['config', '--local', 'deployment', 'true'], envOptions)
  } else {
    // Generate the lockfile so we can use it to compute the cache key.
    // This will also automatically pick up the latest gem versions compatible with the Gemfile.
    await exec.exec('bundle', ['lock'], envOptions)
  }

  // cache key
  const paths = [cachePath]
  const baseKey = await computeBaseKey(platform, engine, architecture, rubyVersion, lockFile)
  const key = `${baseKey}-${await common.hashFile(lockFile)}`
  // If only Gemfile.lock changes we can reuse part of the cache, and clean old gem versions below
  const restoreKeys = [`${baseKey}-`]
  console.log(`Cache key: ${key}`)

  // restore cache & install
  let cachedKey = null
  try {
    cachedKey = await cache.restoreCache(paths, key, restoreKeys)
  } catch (error) {
    if (error.name === cache.ValidationError.name) {
      throw error;
    } else {
      core.info(`[warning] There was an error restoring the cache ${error.message}`)
    }
  }

  if (cachedKey) {
    console.log(`Found cache for key: ${cachedKey}`)
  }

  // Always run 'bundle install' to list the gems
  await exec.exec('bundle', ['install', '--jobs', '4'])

  // @actions/cache only allows to save for non-existing keys
  if (cachedKey !== key) {
    if (cachedKey) { // existing cache but Gemfile.lock differs, clean old gems
      await exec.exec('bundle', ['clean'])
    }

    // Error handling from https://github.com/actions/cache/blob/master/src/save.ts
    console.log('Saving cache')
    try {
      await cache.saveCache(paths, key)
    } catch (error) {
      if (error.name === cache.ValidationError.name) {
        throw error;
      } else if (error.name === cache.ReserveCacheError.name) {
        core.info(error.message);
      } else {
        core.info(`[warning]${error.message}`)
      }
    }
  }

  return true
}

async function computeBaseKey(platform, engine, architecture, version, lockFile) {
  let key = `setup-ruby-bundler-cache-v3-${platform}-${architecture}-${engine}-${version}`

  if (engine !== 'jruby' && common.isHeadVersion(version)) {
    let revision = '';
    await exec.exec('ruby', ['-e', 'print RUBY_REVISION'], {
      silent: true,
      listeners: {
        stdout: (data) => {
          revision += data.toString();
        }
      }
    });
    key += `-revision-${revision}`
  }

  key += `-${lockFile}`
  return key
}

if (__filename.endsWith('index.js')) { run() }
