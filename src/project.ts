import * as path from 'path';
import { pathToFileURL } from 'url';
import { Installation } from './releases';
import { exists, inside, io, writeTransaction } from './files';

export type Target = 'vmx' | 'systemcore';
export interface ProjectState { schemaVersion: 1; target: Target; installation: Installation; }
const begin = '// BEGIN W4Studica ';
const end = '// END W4Studica ';

export function block(name: string, body: string): string { return begin + name + '\n' + body.trim() + '\n' + end + name; }

export function removeBlock(text: string, name: string): string {
    const first = text.indexOf(begin + name + '\n');
    if (first < 0) { return text; }
    const last = text.indexOf(end + name, first);
    if (last < 0) { throw new Error('Incomplete W4Studica managed block: ' + name); }
    const start = first > 0 && text[first - 1] === '\n' ? first - 1 : first;
    return text.slice(0, start) + text.slice(last + (end + name).length).replace(/^\r?\n/, '');
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

function pluginEnd(text: string): number {
    const mask = codeMask(text);
    const match = /\bplugins\s*\{/.exec(mask);
    if (!match) { throw new Error('Expected a plugins block in build.gradle.'); }
    return closeBrace(mask, match.index + match[0].lastIndexOf('{')) + 1;
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

function convertTarget(text: string, target: Target): string {
    const current = detectTarget(text);
    if (current === target) { return text; }
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
        // Keep the original connection calls as inert, reversible comments (never store credentials).
        body = replaceCode(body, /\b(?:useDefaultSystemcoreHostName|useCustomSystemcoreHostName|setAddresses|addAddress)\s*\([^\n]*?\)\s*;?/g,
            (original: string) => '/* W4Studica original host: ' + Buffer.from(original).toString('base64') + ' */');
        body = '\n' + block('connection', "username = System.getenv('VMX_USER') ?: 'ubuntu'\npassword = System.getenv('VMX_PASSWORD') ?: ''") + '\n' + body;
        text = text.slice(0, open + 1) + body + text.slice(close);
    } else {
        text = removeBlock(text, 'connection');
        text = text.replace(/\/\* W4Studica original host: ([A-Za-z0-9+/=]+) \*\//g, (_whole, encoded: string) => Buffer.from(encoded, 'base64').toString('utf8'));
        text = replaceCode(text, /\bgetTargetTypeClass\s*\(\s*(['"])VmxPi\1\s*\)/g, () => "getTargetTypeClass('SystemCore')");
        if (!/\buse(?:Default|Custom)SystemcoreHostName\s*\(/.test(codeMask(text))) {
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

export function configureBuild(original: string, installation: Installation, target: Target): string {
    let text = removeBlock(removeBlock(original, 'libraries'), 'runtime');
    const originalPlugin = /\bid\s*(['"])org\.wpilib\.GradleRIO\1(?:\s+version\s+(['"])[^'"\n]+\2)?/g;
    let pluginCount = 0;
    text = replaceCode(text, originalPlugin, () => { pluginCount++; return 'id "org.wpilib.GradleRIO" version "' + installation.gradlerio.manifest.version + '"'; });
    if (pluginCount !== 1) { throw new Error('Expected org.wpilib.GradleRIO in a WPILib 2027 project. Legacy 2020 projects must be migrated first.'); }
    text = convertTarget(text, target);
    const position = pluginEnd(text);
    const repository = pathToFileURL(inside(installation.allwpilib.directory, installation.allwpilib.manifest.mavenPath)).href;
    const libraries = block('libraries', `
wpi.versions.wpilibVersion.set('${installation.allwpilib.manifest.wpilibVersion}')
repositories {
    exclusiveContent {
        forRepository { maven { url = uri('${repository}') } }
        filter { includeVersionByRegex('org[.]wpilib([.].*)?', '.*', java.util.regex.Pattern.quote('${installation.allwpilib.manifest.wpilibVersion}')) }
    }
}
`);
    text = text.slice(0, position) + '\n' + libraries + '\n' + text.slice(position);
    if (target === 'vmx') {
        const script = installation.allwpilib.manifest.vmxScript;
        if (!script) { throw new Error('The allwpilib release has no prebuilt VMX integration script (vmxScript).'); }
        const scriptPath = inside(installation.allwpilib.directory, script).replace(/\\/g, '/').replace(/'/g, "\\'");
        const bundlePath = installation.allwpilib.directory.replace(/\\/g, '/').replace(/'/g, "\\'");
        text += '\n' + block('runtime', `ext.w4studicaBundleRoot = file('${bundlePath}')\napply from: '${scriptPath}'`) + '\n';
    }
    return text;
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

export function configureWrapper(text: string, windows: boolean): string {
    if (text.includes('W4Studica Gradle home')) { return text; }
    if (windows) {
        const line = /^.*"%JAVA_EXE%".*(?:GradleWrapperMain|gradle-wrapper\.jar).*%\*.*$/m.exec(text);
        if (!line) { throw new Error('Unsupported gradlew.bat launcher'); }
        return text.replace(line[0], '@rem W4Studica Gradle home\r\n' + line[0].replace('%*', '%* --gradle-user-home "%APP_HOME%\\.w4studica\\gradle-home"'));
    }
    const launcher = /^exec "\$JAVACMD" "\$@"\s*$/m;
    if (!launcher.test(text)) { throw new Error('Unsupported gradlew launcher'); }
    return text.replace(launcher, '# W4Studica Gradle home\nset -- "$@" --gradle-user-home "$APP_HOME/.w4studica/gradle-home"\nexec "$JAVACMD" "$@"\n');
}

export const cacheSettings = `// Managed by W4Studica. Project dependencies stay on this computer.
beforeSettings { settings ->
    settings.caches { cleanup = org.gradle.api.cache.Cleanup.DISABLED }
}
def projectRoot = gradle.gradleUserHomeDir.parentFile.parentFile
if (new File(projectRoot, '.w4studica/offline').isFile() && System.getenv('W4STUDICA_ONLINE') != '1') {
    gradle.startParameter.offline = true
}
`;

export async function readState(root: string): Promise<ProjectState | undefined> {
    const file = path.join(root, '.w4studica/config.json');
    if (!await exists(file)) { return undefined; }
    const state = JSON.parse(await io.readFile(file, 'utf8')) as ProjectState;
    if (state.schemaVersion !== 1 || !state.installation || !['vmx', 'systemcore'].includes(state.target)) { throw new Error('Invalid W4Studica project state'); }
    return state;
}

export async function configureProject(root: string, installation: Installation, target: Target): Promise<void> {
    if (await exists(path.join(root, 'build.gradle.kts')) || await exists(path.join(root, 'settings.gradle.kts'))) { throw new Error('Only Groovy build.gradle/settings.gradle projects are supported.'); }
    const changes = new Map<string, string>();
    const buildFile = path.join(root, 'build.gradle');
    const settingsFile = path.join(root, 'settings.gradle');
    const originalBuild = await io.readFile(buildFile, 'utf8');
    const originalSettings = await exists(settingsFile) ? await io.readFile(settingsFile, 'utf8') : '';
    changes.set(buildFile, configureBuild(originalBuild, installation, target));
    changes.set(settingsFile, configureSettings(originalSettings, installation));
    for (const [name, windows] of [['gradlew', false], ['gradlew.bat', true]] as [string, boolean][]) {
        const file = path.join(root, name);
        if (await exists(file)) { changes.set(file, configureWrapper(await io.readFile(file, 'utf8'), windows)); }
    }
    const ignoreFile = path.join(root, '.gitignore');
    const ignore = await exists(ignoreFile) ? await io.readFile(ignoreFile, 'utf8') : '';
    if (!/^\/\.w4studica\/$/m.test(ignore)) { changes.set(ignoreFile, ignore + '\n/.w4studica/\n'); }
    const state: ProjectState = { schemaVersion: 1, target, installation };
    changes.set(path.join(root, '.w4studica/config.json'), JSON.stringify(state, null, 2) + '\n');
    changes.set(path.join(root, '.w4studica/gradle-home/init.d/w4studica.gradle'), cacheSettings);
    // One initial backup, for manual recovery; later target switches preserve user edits.
    for (const [name, contents] of [['build.gradle', originalBuild], ['settings.gradle', originalSettings]]) {
        const backup = path.join(root, '.w4studica/backup', name);
        if (!await exists(backup)) { changes.set(backup, contents); }
    }
    // Invalidate offline readiness before changing dependencies or target.
    const offline = path.join(root, '.w4studica/offline');
    if (await exists(offline)) { changes.set(offline, ''); }
    await writeTransaction(changes);
    if (changes.has(offline)) { await io.unlink(offline); }
}
