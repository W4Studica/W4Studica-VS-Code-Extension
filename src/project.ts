import * as path from 'path';
import { createHash } from 'crypto';
import * as os from 'os';
import { pathToFileURL } from 'url';
import { Installation } from './releases';
import { atomicWrite, exists, inside, io, writeTransaction } from './files';

export type Target = 'vmx' | 'systemcore';
export interface ProjectState { schemaVersion: 1 | 2; target: Target; installation: Installation; projectStorageDir: string; systemcoreHostCalls?: string[]; }
const begin = '// BEGIN W4Studica ';
const end = '// END W4Studica ';

export function block(name: string, body: string): string { return begin + name + '\n' + body.trim() + '\n' + end + name; }

export function removeBlock(text: string, name: string): string {
    const marker = begin + name;
    let first = text.indexOf(marker);
    while (first >= 0 && !/^\r?\n/.test(text.slice(first + marker.length))) {
        first = text.indexOf(marker, first + marker.length);
    }
    if (first < 0) { return text; }
    const last = text.indexOf(end + name, first);
    if (last < 0) { throw new Error('Incomplete W4Studica managed block: ' + name); }
    let start = first > 0 && text[first - 1] === '\n' ? first - 1 : first;
    if (start > 0 && text[start - 1] === '\r') { start--; }
    return text.slice(0, start) + text.slice(last + (end + name).length).replace(/^\r?\n/, '');
}

function removeConnectionSettings(text: string): string {
    text = removeBlock(text, 'connection');
    return text.replace(/^[ \t]*username = System\.getenv\('VMX_USER'\) \?: 'ubuntu'\r?\n[ \t]*password = System\.getenv\('VMX_PASSWORD'\) \?: 'password'[ \t]*(?:\r?\n|$)/gm, '');
}

function legacyHostCalls(text: string): string[] {
    return Array.from(text.matchAll(/\/\* W4Studica original host: ([A-Za-z0-9+/=]+) \*\//g), match => Buffer.from(match[1], 'base64').toString('utf8'));
}

export function extractSystemcoreHostCalls(text: string): string[] {
    const mask = codeMask(text);
    const target = /\b\w+\s*\(\s*getTargetTypeClass\s*\(\s*(['"])SystemCore\1\s*\)\s*\)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = target.exec(text))) {
        if (mask[match.index] === ' ') { continue; }
        const open = match.index + match[0].lastIndexOf('{');
        const bodyMask = mask.slice(open + 1, closeBrace(mask, open));
        const body = text.slice(open + 1, closeBrace(mask, open));
        const call = /(?:^|\n)[ \t]*(?:useDefaultSystemcoreHostName|useCustomSystemcoreHostName|setAddresses|addAddress)\s*\([^\r\n]*?\)\s*;?[ \t]*/g;
        const calls: string[] = [];
        let found: RegExpExecArray | null;
        while ((found = call.exec(body))) {
            const method = found[0].search(/(?:useDefaultSystemcoreHostName|useCustomSystemcoreHostName|setAddresses|addAddress)/);
            if (method >= 0 && bodyMask[found.index + method] !== ' ') {
                calls.push(found[0].trim());
            }
        }
        return calls;
    }
    return [];
}

// Preserve indices while hiding Groovy strings and comments from structural searches.
export function codeMask(text: string): string {
    const chars = text.split('');
    let i = 0;
    while (i < text.length) {
        const start = i;
        if (text.startsWith('//', i)) { i = text.indexOf('\n', i); if (i < 0) { i = text.length; } }
        else if (text.startsWith('/*', i)) { const close = text.indexOf('*/', i + 2); if (close < 0) { throw new Error('Unclosed Gradle comment'); } i = close + 2; }
        else if (text[i] === "'" || text[i] === '"') {
            const quote = text.startsWith(text[i].repeat(3), i) ? text[i].repeat(3) : text[i];
            i += quote.length;
            let closed = false;
            while (i < text.length) {
                if (text[i] === '\\') { i += 2; }
                else if (text.startsWith(quote, i)) { i += quote.length; closed = true; break; }
                else { i++; }
            }
            if (!closed) { throw new Error('Unclosed Gradle string'); }
        } else { i++; continue; }
        for (let j = start; j < i; j++) { if (chars[j] !== '\n' && chars[j] !== '\r') { chars[j] = ' '; } }
    }
    return chars.join('');
}

function replaceCode(text: string, pattern: RegExp, replacement: (...args: any[]) => string): string {
    const mask = codeMask(text);
    return text.replace(pattern, (...args: any[]) => mask[args[args.length - 2]] === ' ' ? args[0] : replacement(...args));
}

function closeBrace(mask: string, open: number): number {
    let depth = 1;
    for (let i = open + 1; i < mask.length; i++) {
        if (mask[i] === '{') { depth++; }
        if (mask[i] === '}' && --depth === 0) { return i; }
    }
    throw new Error('Unbalanced Gradle braces');
}

export function detectTarget(text: string): Target {
    const mask = codeMask(text);
    const found: Target[] = [];
    const pattern = /\b\w+\s*\(\s*getTargetTypeClass\s*\(\s*(['"])(SystemCore|VmxPi)\1\s*\)\s*\)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
        if (mask[match.index] !== ' ') { found.push(match[2] === 'VmxPi' ? 'vmx' : 'systemcore'); }
    }
    if (found.length !== 1) { throw new Error('Expected exactly one SystemCore or VmxPi deploy target in a WPILib 2027 Groovy project.'); }
    return found[0];
}

function convertTarget(text: string, target: Target, systemcoreHostCalls?: string[]): string {
    const current = detectTarget(text);
    if (current === target) { return target === 'vmx' ? removeConnectionSettings(text) : text; }
    if (target === 'vmx') {
        // The existing target name is kept, so references such as deploy.targets.systemcore still work.
        text = replaceCode(text, /\bgetTargetTypeClass\s*\(\s*(['"])SystemCore\1\s*\)/g, () => "getTargetTypeClass('VmxPi')");
        const mask = codeMask(text);
        const declaration = /\b\w+\s*\(\s*getTargetTypeClass\s*\(\s*(['"])VmxPi\1\s*\)\s*\)\s*\{/g;
        let match: RegExpExecArray | null;
        let open = -1;
        while ((match = declaration.exec(text))) { if (mask[match.index] !== ' ') { open = match.index + match[0].lastIndexOf('{'); break; } }
        if (open < 0) { throw new Error('Cannot locate VmxPi target'); }
        const close = closeBrace(mask, open);
        let body = text.slice(open + 1, close);
        body = replaceCode(body, /(?:^|\n)[ \t]*(?:useDefaultSystemcoreHostName|useCustomSystemcoreHostName|setAddresses|addAddress)\s*\([^\n]*?\)\s*;?[ \t]*/g,
            (original: string) => original.startsWith('\n') ? '\n' : '');
        text = text.slice(0, open + 1) + body + text.slice(close);
        text = removeConnectionSettings(text);
    } else {
        text = removeConnectionSettings(text);
        const restoredHostCalls = systemcoreHostCalls?.length ? systemcoreHostCalls : legacyHostCalls(text);
        text = text.replace(/\/\* W4Studica original host: [A-Za-z0-9+/=]+ \*\//g, '');
        text = replaceCode(text, /\bgetTargetTypeClass\s*\(\s*(['"])VmxPi\1\s*\)/g, () => "getTargetTypeClass('SystemCore')");
        if (restoredHostCalls.length) {
            text = replaceCode(text, /(\b\w+\s*\(\s*getTargetTypeClass\s*\(\s*(['"])SystemCore\2\s*\)\s*\)\s*\{)/g,
                (declaration: string) => declaration + '\n' + restoredHostCalls.join('\n') + '\n');
        } else if (!/\buse(?:Default|Custom)SystemcoreHostName\s*\(/.test(codeMask(text))) {
            // Native VMX projects have no SystemCore host call to restore.
            text = replaceCode(text, /\b\w+\s*\(\s*getTargetTypeClass\s*\(\s*(['"])SystemCore\1\s*\)\s*\)\s*\{/g,
                (declaration: string) => declaration + "\nuseDefaultSystemcoreHostName()\n");
        }
    }
    const from = target === 'vmx' ? 'systemcore' : 'linuxarm64';
    const to = target === 'vmx' ? 'linuxarm64' : 'systemcore';
    text = replaceCode(text, new RegExp('\\bwpi\\.platforms\\.' + from + '\\b', 'g'), () => 'wpi.platforms.' + to);
    for (const suffix of ['Debug', 'Release']) {
        text = replaceCode(text, new RegExp('\\b' + (target === 'vmx' ? 'systemcore' : 'vmx') + suffix + '\\b', 'g'), () => (target === 'vmx' ? 'vmx' : 'systemcore') + suffix);
    }
    return text;
}

export function configureBuild(original: string, installation: Installation, target: Target, systemcoreHostCalls?: string[]): string {
    let text = removeBlock(removeBlock(original, 'libraries'), 'runtime');
    const originalPlugin = /\bid\s*(['"])org\.wpilib\.GradleRIO\1(?:\s+version\s+(['"])[^'"\n]+\2)?/g;
    let pluginCount = 0;
    text = replaceCode(text, originalPlugin, () => { pluginCount++; return 'id "org.wpilib.GradleRIO" version "' + installation.gradlerio.manifest.version + '"'; });
    if (pluginCount !== 1) { throw new Error('Expected org.wpilib.GradleRIO in a WPILib 2027 project. Legacy 2020 projects must be migrated first.'); }
    text = convertTarget(text, target, systemcoreHostCalls);
    if (target === 'vmx' && !installation.allwpilib.manifest.vmxScript) { throw new Error('The allwpilib release has no prebuilt VMX integration script (vmxScript).'); }
    // One short project hook loads the versioned repositories, VMX support, and per-project state
    // from the WPILib 2027 user installation. No absolute machine paths or caches go in the project.
    const applyLine = "apply from: new File(System.getProperty('user.home'), 'wpilib/2027/W4Studica/w4studica.gradle')";
    text = text.replace(/\r?\n[ \t]*apply from: new File\(System\.getProperty\('user\.home'\), 'wpilib\/2027\/W4Studica\/w4studica\.gradle'\)[ \t]*\r?\n?/g, '');
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    return text.replace(/[ \t\r\n]*$/, '') + newline + applyLine + newline;
}

export function configureSettings(original: string, installation: Installation): string {
    let text = removeBlock(original, 'plugin repositories');
    // Composite builds bypass plugin repositories and would select a source checkout instead of the release.
    if (/\bincludeBuild\s*\(/.test(codeMask(text))) { throw new Error('settings.gradle contains includeBuild. Remove the GradleRIO source-checkout connection before using prebuilt releases.'); }
    const repos = [installation.gradlerio, installation.allwpilib].map(i => pathToFileURL(inside(i.directory, i.manifest.mavenPath)).href);
    const managed = block('plugin repositories', `repositories {
    exclusiveContent {
        forRepository { maven { url = uri('${repos[0]}') } }
        filter {
            includeModule('org.wpilib.GradleRIO', 'org.wpilib.GradleRIO.gradle.plugin')
            includeModule('org.wpilib', 'GradleRIO')
        }
    }
${repos.map(url => "    maven { url = uri('" + url + "') }").join('\n')}
    gradlePluginPortal()
}`);
    const mask = codeMask(text);
    const match = /\bpluginManagement\s*\{/.exec(mask);
    if (match) {
        const open = match.index + match[0].lastIndexOf('{') + 1;
        text = text.slice(0, open) + '\n' + managed + '\n' + text.slice(open);
    } else { text = 'pluginManagement {\n' + managed + '\n}\n' + text; }
    return text;
}

export function restoreWrapper(text: string, windows: boolean): string {
    if (windows) {
        return text.replace(/^@rem W4Studica Gradle home\r?\n/m, '').replace(/ --gradle-user-home "%APP_HOME%\\.w4studica\\gradle-home"/g, '');
    }
    return text.replace(/^# W4Studica Gradle home\r?\nset -- "\$@" --gradle-user-home "\$APP_HOME\/\.w4studica\/gradle-home"\r?\n/m, '');
}

export function projectStorageDir(root: string, w4Home = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica')): string {
    const key = createHash('sha256').update(path.resolve(root).replace(/\\/g, '/')).digest('hex');
    return path.join(w4Home, 'projects', key);
}

export function migrateVmxScript(script: string): string {
    return script.replace(/dependsOn(\s+tasks\.named\(['"]fetchVmxSdk' \+ vmxTarget\.name\))/g, 'mustRunAfter$1');
}

export async function refreshVmxScript(root: string, installation: Installation,
    w4Home = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica')): Promise<void> {
    const scriptPath = installation.allwpilib.manifest.vmxScript;
    if (!scriptPath) { return; }
    const script = migrateVmxScript(await io.readFile(inside(installation.allwpilib.directory, scriptPath), 'utf8'))
        .replace(/file\(['"]\.w4studica\/vmx-sdk['"]\)/g, "new File(w4studicaProjectStorage, 'vmx-sdk')");
    await atomicWrite(path.join(projectStorageDir(root, w4Home), 'vmx.gradle'), script);
}

export const globalGradleScript = `import groovy.json.JsonSlurper
import java.security.MessageDigest
def w4Home = new File(System.getProperty('user.home'), 'wpilib/2027/W4Studica')
def projectPath = project.rootDir.canonicalPath.replace('\\\\', '/')
def projectKey = MessageDigest.getInstance('SHA-256').digest(projectPath.getBytes('UTF-8')).encodeHex().toString()
def w4Project = new File(w4Home, 'projects/' + projectKey)
def stateFile = new File(w4Project, 'config.json')
if (!stateFile.isFile()) throw new GradleException('W4Studica project settings are missing. Reconnect the project with the W4Studica extension.')
def state = new JsonSlurper().parse(stateFile)
def allwpilib = state.installation.allwpilib
def wpilibVersion = allwpilib.manifest.wpilibVersion
wpi.versions.wpilibVersion.set(wpilibVersion)
repositories {
    exclusiveContent {
        forRepository { maven { url = new File(allwpilib.directory, allwpilib.manifest.mavenPath).toURI() } }
        filter { includeVersionByRegex('org[.]wpilib([.].*)?', '.*', java.util.regex.Pattern.quote(wpilibVersion)) }
    }
}
ext.w4studicaBundleRoot = file(allwpilib.directory)
ext.w4studicaProjectStorage = w4Project
if (state.target == 'vmx') apply from: new File(w4Project, 'vmx.gradle')
if (new File(w4Project, 'offline').isFile() && System.getenv('W4STUDICA_ONLINE') != '1') gradle.startParameter.offline = true
`;

export async function readState(root: string, w4Home = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica')): Promise<ProjectState | undefined> {
    const directory = projectStorageDir(root, w4Home);
    const file = path.join(directory, 'config.json');
    if (!await exists(file)) {
        // Allow a project configured by the previous extension build to be upgraded in place.
        const legacy = path.join(root, '.w4studica/config.json');
        if (!await exists(legacy)) { return undefined; }
        const state = JSON.parse(await io.readFile(legacy, 'utf8')) as { target: Target; installation: Installation };
        return { schemaVersion: 1, target: state.target, installation: state.installation, projectStorageDir: directory };
    }
    const state = JSON.parse(await io.readFile(file, 'utf8')) as ProjectState;
    if (state.schemaVersion !== 2 || !state.installation || !['vmx', 'systemcore'].includes(state.target)) { throw new Error('Invalid W4Studica project state'); }
    return state;
}

async function copyDirectory(source: string, destination: string): Promise<void> {
    if (!await exists(source)) { return; }
    await io.mkdir(destination, { recursive: true });
    for (const entry of await io.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name); const to = path.join(destination, entry.name);
        if (entry.isDirectory()) { await copyDirectory(from, to); }
        else if (!await exists(to)) { await io.copyFile(from, to); }
    }
}

export async function configureProject(root: string, installation: Installation, target: Target,
    w4Home = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica'), gradleHome = path.join(os.homedir(), '.gradle')): Promise<void> {
    if (await exists(path.join(root, 'build.gradle.kts')) || await exists(path.join(root, 'settings.gradle.kts'))) { throw new Error('Only Groovy build.gradle/settings.gradle projects are supported.'); }
    const changes = new Map<string, string>();
    const buildFile = path.join(root, 'build.gradle');
    const settingsFile = path.join(root, 'settings.gradle');
    const originalBuild = await io.readFile(buildFile, 'utf8');
    const originalSettings = await exists(settingsFile) ? await io.readFile(settingsFile, 'utf8') : '';
    const currentTarget = detectTarget(originalBuild);
    const previousState = await readState(root, w4Home);
    const systemcoreCalls = currentTarget === 'systemcore'
        ? extractSystemcoreHostCalls(originalBuild)
        : previousState?.systemcoreHostCalls || legacyHostCalls(originalBuild);
    changes.set(buildFile, configureBuild(originalBuild, installation, target, systemcoreCalls));
    changes.set(settingsFile, configureSettings(originalSettings, installation));
    for (const [name, windows] of [['gradlew', false], ['gradlew.bat', true]] as [string, boolean][]) {
        const file = path.join(root, name);
        if (await exists(file)) { changes.set(file, restoreWrapper(await io.readFile(file, 'utf8'), windows)); }
    }
    const dataDir = projectStorageDir(root, w4Home);
    const legacyDir = path.join(root, '.w4studica');
    await io.mkdir(dataDir, { recursive: true });
    await copyDirectory(path.join(legacyDir, 'backup'), path.join(dataDir, 'backup'));
    await copyDirectory(path.join(legacyDir, 'vmx-sdk'), path.join(dataDir, 'vmx-sdk'));
    await copyDirectory(path.join(legacyDir, 'gradle-home', 'caches'), path.join(gradleHome, 'caches'));
    await copyDirectory(path.join(legacyDir, 'gradle-home', 'wrapper'), path.join(gradleHome, 'wrapper'));
    const ignoreFile = path.join(root, '.gitignore');
    const ignore = await exists(ignoreFile) ? await io.readFile(ignoreFile, 'utf8') : '';
    const cleanIgnore = ignore.replace(/^\/?\.w4studica\/?\s*\r?\n/gm, '').replace(/\n{3,}/g, '\n\n');
    if (cleanIgnore !== ignore) { changes.set(ignoreFile, cleanIgnore); }
    const state: ProjectState = { schemaVersion: 2, target, installation, projectStorageDir: dataDir,
        ...(target === 'vmx' ? { systemcoreHostCalls: systemcoreCalls } : {}) };
    changes.set(path.join(dataDir, 'config.json'), JSON.stringify(state, null, 2) + '\n');
    changes.set(path.join(w4Home, 'w4studica.gradle'), globalGradleScript);
    if (target === 'vmx' && installation.allwpilib.manifest.vmxScript) {
        const vmxScript = await io.readFile(inside(installation.allwpilib.directory, installation.allwpilib.manifest.vmxScript), 'utf8');
        const migratedScript = migrateVmxScript(vmxScript).replace(/file\(['"]\.w4studica\/vmx-sdk['"]\)/g, "new File(w4studicaProjectStorage, 'vmx-sdk')");
        changes.set(path.join(dataDir, 'vmx.gradle'), migratedScript);
    }
    // One initial backup, for manual recovery; later target switches preserve user edits.
    for (const [name, contents] of [['build.gradle', originalBuild], ['settings.gradle', originalSettings]]) {
        const backup = path.join(dataDir, 'backup', name);
        if (!await exists(backup)) { changes.set(backup, contents); }
    }
    // Invalidate offline readiness before changing dependencies or target.
    const offline = path.join(dataDir, 'offline');
    if (await exists(offline)) { changes.set(offline, ''); }
    await writeTransaction(changes);
    if (changes.has(offline)) { await io.unlink(offline); }
    if (await exists(legacyDir)) { await io.rm(legacyDir, { recursive: true, force: true }); }
}
