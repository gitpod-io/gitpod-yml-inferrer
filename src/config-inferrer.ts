import { WorkspaceConfig } from "./config";

interface Ctx extends FS {
    config: WorkspaceConfig;
}

export interface FS {
    getFullPath(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string | undefined>;
    list(folderPath: string): Promise<string[]>;
}

export class ConfigInferrer {

    protected contributions:((ctx:Ctx)=>Promise<void>)[] = [
        this.checkNode.bind(this),
        this.checkJava.bind(this),
        this.checkPython.bind(this),
        this.checkGo.bind(this),
        this.checkRust.bind(this),
        this.checkMake.bind(this)
    ]
    
    async getConfig(fs: FS): Promise<WorkspaceConfig> {
        const ctx: Ctx = {
            getFullPath: fs.getFullPath.bind(fs),
            exists: fs.exists.bind(fs),
            read: fs.read.bind(fs),
            list: fs.list.bind(fs),
            config: {}
        };
        for (const contrib of this.contributions) {
            try {
                await contrib(ctx);
            } catch (e) {
                console.log(e);
            }
        }
        return ctx.config;
    }

    protected async checkNode(ctx: Ctx): Promise<void> {
        const pckjsonContent = await ctx.read('package.json');
        if (!pckjsonContent) {
            return;
        }
        let command: 'yarn'|'npm' = 'npm';
        if (await ctx.exists('yarn.lock')) {
            command = 'yarn';
        }
        this.addCommand(ctx.config, command + ' install', 'init');
        try {
            const pckjson = JSON.parse(pckjsonContent);
            if (pckjson.scripts) {
                if (pckjson.scripts.build) {
                    this.addCommand(ctx.config, command + ' run build', 'init');
                }
                if (pckjson.scripts.start) {
                    this.addCommand(ctx.config, command + ' run start', 'command');
                } else if (pckjson.scripts.dev) {
                    this.addCommand(ctx.config, command + ' run dev', 'command');
                } else if (pckjson.scripts.watch){
                    this.addCommand(ctx.config, command + ' run watch', 'command');
                }
            }
        } catch (e) {
            console.log(e, pckjsonContent);
        }
    }

    protected async checkJava(ctx: Ctx): Promise<void> {
        if (await ctx.exists('build.gradle')) {
            let cmd = 'gradle';
            if (await ctx.exists('gradlew')) {
                cmd = './gradlew';
            }
            this.addCommand(ctx.config, cmd + ' build', 'init');
            return;
        }
        if (await ctx.exists('pom.xml')) {
            let cmd = 'mvn';
            if (await ctx.exists('mvnw')) {
                cmd = './mvnw';
            }
            this.addCommand(ctx.config, cmd + ' install -DskipTests=false', 'init');
            return;
        }
    }

    protected async isMake(ctx: Ctx) {
        return await ctx.exists('Makefile') || await ctx.exists('makefile');
    }

    protected async checkMake(ctx: Ctx) {
        if (await ctx.exists('CMakeLists.txt')) {
            this.addCommand(ctx.config, 'cmake .', 'init');
        } else if (await this.isMake(ctx)) {
            this.addCommand(ctx.config, 'make', 'init');
        }
    }

    protected async checkPython(ctx: Ctx) {
        if (await this.isMake(ctx)) {
            // https://docs.python-guide.org/writing/structure/#makefile
            return;
        }
        if (await ctx.exists('requirements.txt')) {
            this.addCommand(ctx.config, 'pip install -r ./requirements.txt', 'init');
        } else if (await ctx.exists('setup.py')) {
            this.addCommand(ctx.config, 'pip install .', 'init');
        }
    }

    protected async checkGo(ctx: Ctx) {
        if (await ctx.exists('go.mod')) {
            this.addCommand(ctx.config, 'go get', 'init');
            this.addCommand(ctx.config, 'go build ./...', 'init');
            this.addCommand(ctx.config, 'go test ./...', 'init');
            this.addCommand(ctx.config, 'go run', 'command');
        }
    }

    protected async checkRust(ctx: Ctx) {
        if (await ctx.exists('Cargo.toml')) {
            this.addCommand(ctx.config, 'cargo build', 'init');
            this.addCommand(ctx.config, 'cargo watch -x run', 'command');
        }
    }

    protected addCommand(config: WorkspaceConfig, command: string, phase: 'before'|'init'|'command', unless?:string): void {
        if (!config.tasks) {
            config.tasks = [];
        }
        if (!config.tasks[0]) {
            config.tasks.push({});
        }
        const existing = config.tasks[0][phase];
        if (unless && existing && existing.indexOf(unless) !== -1) {
            // skip
            return;
        }
        config.tasks[0][phase] = (existing ? existing + ' && ':'') + command;
    }
}