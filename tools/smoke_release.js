// Install real release ZIPs, then build fresh C++ and Java consumers through the extension's code.
// Usage: node tools/smoke_release.js RELEASE_ROOT LOCAL_VMX_SDK [--vmx-only]
// The generated build.gradle loads ~/wpilib/2027/W4Studica/w4studica.gradle, so project data goes to that real folder
// (one projects/<hash> entry per validation project; delete them afterwards). Set GRADLE_USER_HOME to an isolated Gradle
// home (with wrapper and toolchains linked in) so a personal ~/.gradle/init.d script cannot interfere.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Response } = require('node-fetch');
const { installComponent } = require('../out/releases');
const { configureProject, projectStorageDir } = require('../out/project');
const { runGradle, saveOffline } = require('../out/offline');

async function main() {
    const releaseRoot = path.resolve(process.argv[2]);
    const sdk = path.resolve(process.argv[3]);
    const sourceRoot = path.resolve(__dirname, '../..');
    const validation = path.join(releaseRoot, 'validation');
    const log = message => process.stdout.write(message + '\n');
    const installation = {};
    for (const component of ['gradlerio', 'allwpilib']) {
        const assets = path.join(releaseRoot, component, 'assets');
        const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'w4studica.json'), 'utf8'));
        const repository = 'W4Studica/' + (component === 'gradlerio' ? 'GradleRIO' : 'allwpilib');
        const candidate = { repository, manifest, release: { tag_name: 'v' + manifest.version, draft: false, prerelease: true,
            assets: [{ archive: manifest.archive }, ...(manifest.additionalArchives || [])].map(part => ({ name: part.archive,
                browser_download_url: 'https://github.com/' + repository + '/releases/download/v' + manifest.version + '/' + part.archive })) } };
        installation[component] = await installComponent(candidate, path.join(validation, 'installed'), log,
            async url => new Response(fs.createReadStream(path.join(assets, path.basename(new URL(url).pathname)))));
    }
    for (const language of ['cpp', 'java']) {
        const root = path.join(validation, language);
        fs.mkdirSync(root, { recursive: true });
        const artifact = language === 'cpp' ? 'wpilibCpp' : 'wpilibJava';
        const type = language === 'cpp' ? 'WPILibNativeArtifact' : 'WPILibJavaArtifact';
        let build = `plugins { id '${language}'; ${language === 'java' ? "id 'application';" : ''} id 'org.wpilib.GradleRIO' version '${installation.gradlerio.manifest.version}' }
deploy { targets { robot(getTargetTypeClass('SystemCore')) {
    team = 1234
    useDefaultSystemcoreHostName()
    artifacts { ${artifact}(getArtifactTypeClass('${type}')) {} }
} } }
def deployArtifact = deploy.targets.robot.artifacts.${artifact}
`;
        if (language === 'cpp') {
            build += `model { components { userProgram(NativeExecutableSpec) {
    targetPlatform wpi.platforms.systemcore
    sources.cpp { source { srcDir 'src/main/cpp' } }
    deployArtifact.component = it
    wpi.cpp.enableExternalTasks(it)
    wpi.cpp.deps.wpilib(it)
} } }
`;
            fs.mkdirSync(path.join(root, 'src/main/cpp'), { recursive: true });
            fs.writeFileSync(path.join(root, 'src/main/cpp/main.cpp'), '#include "wpi/hardware/discrete/AnalogInput.hpp"\nint main() { wpi::AnalogInput input{0}; return input.GetChannel(); }\n');
        } else {
            build += `dependencies {
    implementation wpi.java.deps.wpilib()
    systemcoreDebug wpi.java.deps.wpilibJniDebug(wpi.platforms.systemcore)
    systemcoreRelease wpi.java.deps.wpilibJniRelease(wpi.platforms.systemcore)
}
application.mainClass = 'robot.Main'
deployArtifact.configureApplication(application)
wpi.java.configureApplication(application)
wpi.java.configureTestTasks(test)
`;
            fs.mkdirSync(path.join(root, 'src/main/java/robot'), { recursive: true });
            fs.writeFileSync(path.join(root, 'src/main/java/robot/Main.java'), 'package robot; public class Main { public static void main(String[] args) { try (var input = new org.wpilib.hardware.discrete.AnalogInput(0)) { System.out.println(input.getChannel()); } } }\n');
        }
        fs.writeFileSync(path.join(root, 'build.gradle'), build);
        for (const file of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties']) {
            const output = path.join(root, file);
            fs.mkdirSync(path.dirname(output), { recursive: true });
            fs.copyFileSync(path.join(sourceRoot, 'GradleRIO/examples/vmx-cpp', file), output);
        }
        fs.chmodSync(path.join(root, 'gradlew'), 0o755);
        await configureProject(root, installation, 'vmx');
        const dataDir = projectStorageDir(root);
        const sdkLink = path.join(dataDir, 'vmx-sdk');
        if (!fs.existsSync(sdkLink)) { fs.symlinkSync(sdk, sdkLink, 'dir'); }
        await runGradle(root, ['--no-daemon', '--max-workers=2', 'build'], true, log);
        await saveOffline(root, { schemaVersion: 2, target: 'vmx', installation, projectStorageDir: dataDir }, log);
        await runGradle(root, ['--no-daemon', '--max-workers=2', 'clean', 'build'], false, log);
        if (process.argv.includes('--vmx-only')) { continue; }
        await configureProject(root, installation, 'systemcore');
        await runGradle(root, ['--no-daemon', '--max-workers=2', 'build'], true, log);
    }
    log(process.argv.includes('--vmx-only') ? 'PASS: release ZIP installation and C++/Java VMX build/offline rebuild.' : 'PASS: release ZIP installation, C++/Java VMX build/offline rebuild and SystemCore return build.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
