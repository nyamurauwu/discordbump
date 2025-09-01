require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { CustomStatus } = require('discord.js-selfbot-rpc');
const fs = require('fs').promises;
const path = require('path');

/**
 * Configurações centralizadas do bot
 * Cara, concentrei tudo aqui pra não ficar espalhado pelo código
 * Se precisar mudar algo, é só vir aqui que tá tudo organizadinho
 */
class Config {
    constructor() {
        // Arquivo onde salva os dados do bot (mudei pra JSON que é bem melhor)
        this.DATA_FILE = path.join(__dirname, 'bumpData.json'); 
        
        // ID do cargo que pode usar os comandos (pega do .env)
        this.ROLE_ID = process.env.ADMIN_ROLE_ID || '1262597302212624465';
        
        // Canal onde vai fazer o bump
        this.BUMP_CHANNEL = process.env.BUMP_CHANNEL;
        
        // Token do bot (nunca commita isso no github hein!)
        this.TOKEN = process.env.TOKEN;
        
        // Intervalos em milissegundos (1000ms = 1 segundo)
        this.STATUS_COOLDOWN = 30000; // 30s - tempo entre atualizações do status
        this.BUMP_MIN_INTERVAL = 7200000; // 2h - mínimo entre bumps
        this.BUMP_MAX_INTERVAL = 9000000; // 2.5h - máximo entre bumps
        this.COMMAND_COOLDOWN = 10000; // 10s - cooldown do comando
        this.RETRY_DELAY = 5000; // 5s - delay entre tentativas
        this.MAX_RETRIES = 3; // máximo de tentativas se o bump falhar
        this.RESTART_DELAY = 300000; // 5min - delay pra tentar de novo após falha
        
        // Valida as configurações obrigatórias
        this.validate();
    }
    
    // Verifica se tá tudo configurado direitinho
    validate() {
        const required = ['BUMP_CHANNEL', 'TOKEN'];
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Faltou configurar essas variáveis no .env: ${missing.join(', ')}`);
        }
        
        // Verifica se o ID do canal só tem números (como deve ser)
        if (!this.BUMP_CHANNEL.match(/^\d+$/)) {
            throw new Error('BUMP_CHANNEL tem que ter só números cara!');
        }
    }
}

/**
 * Sistema de log melhorado
 * Coloquei emoji pra ficar mais bonito e organizei por níveis
 * Agora fica fácil de ver o que tá rolando no console
 */
class Logger {
    static info(message) {
        console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ℹ️  ${message}`);
    }
    
    static success(message) {
        console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ✅ ${message}`);
    }
    
    static warn(message) {
        console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ⚠️  ${message}`);
    }
    
    static error(message, error = null) {
        console.error(`[${new Date().toLocaleTimeString('pt-BR')}] ❌ ${message}`);
        if (error && error.stack) {
            console.error(error.stack);
        }
    }
    
    // Só mostra se DEBUG=true no .env
    static debug(message) {
        if (process.env.DEBUG === 'true') {
            console.log(`[${new Date().toLocaleTimeString('pt-BR')}] 🐛 ${message}`);
        }
    }
}

/**
 * Estado atual do bot
 * Aqui fica todos os dados que o bot precisa lembrar
 * Usei getters/setters pra validar os valores automaticamente
 */
class AppState {
    constructor() {
        this._bumpCount = 0; // quantos bumps já fez
        this._remainingTime = 0; // tempo restante pro próximo bump
        this._lastUpdateTime = 0; // última vez que atualizou o status
        this._isBumping = false; // se tá fazendo bump agora
        this._retryCount = 0; // tentativas de bump
        
        // Sets pra controlar timers (evita memory leak)
        this._intervals = new Set();
        this._timeouts = new Set();
    }
    
    // Getters e setters com validação automática
    get bumpCount() { return this._bumpCount; }
    set bumpCount(value) { 
        this._bumpCount = Math.max(0, parseInt(value) || 0);
    }
    
    get remainingTime() { return this._remainingTime; }
    set remainingTime(value) {
        this._remainingTime = Math.max(0, parseFloat(value) || 0);
    }
    
    get lastUpdateTime() { return this._lastUpdateTime; }
    set lastUpdateTime(value) { this._lastUpdateTime = value; }
    
    get isBumping() { return this._isBumping; }
    set isBumping(value) { this._isBumping = Boolean(value); }
    
    get retryCount() { return this._retryCount; }
    set retryCount(value) { this._retryCount = Math.max(0, parseInt(value) || 0); }
    
    // Métodos pra gerenciar timers (importante pra não vazar memória)
    addInterval(interval) { this._intervals.add(interval); }
    addTimeout(timeout) { this._timeouts.add(timeout); }
    
    // Para todos os timers quando o bot for desligar
    clearAllTimers() {
        this._intervals.forEach(interval => clearInterval(interval));
        this._timeouts.forEach(timeout => clearTimeout(timeout));
        this._intervals.clear();
        this._timeouts.clear();
    }
}

/**
 * Gerenciador de dados
 * Mudei pra JSON que é muito melhor que TXT
 * Agora tem backup automático também, caso dê problema
 */
class DataManager {
    constructor(config) {
        this.config = config;
        // Arquivo de backup (sempre bom ter né)
        this.backupFile = this.config.DATA_FILE.replace('.json', '.backup.json');
    }
    
    // Carrega os dados salvos
    async load(state) {
        try {
            const data = await fs.readFile(this.config.DATA_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            
            if (this.isValidData(parsed)) {
                state.bumpCount = parsed.bumpCount || 0;
                state.remainingTime = parsed.remainingTime || 0;
                Logger.info(`Dados carregados: ${state.bumpCount} bumps, ${Math.floor(state.remainingTime)}s restantes`);
            } else {
                throw new Error('Formato de dados inválido');
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                Logger.info('Primeira vez rodando? Arquivo de dados não encontrado, começando do zero');
            } else {
                Logger.error('Deu ruim ao carregar dados, tentando backup', error);
                await this.loadBackup(state);
            }
        }
    }
    
    // Tenta carregar o backup se o arquivo principal der problema
    async loadBackup(state) {
        try {
            const data = await fs.readFile(this.backupFile, 'utf-8');
            const parsed = JSON.parse(data);
            
            if (this.isValidData(parsed)) {
                state.bumpCount = parsed.bumpCount || 0;
                state.remainingTime = parsed.remainingTime || 0;
                Logger.success('Consegui carregar o backup! Ufa!');
            }
        } catch {
            Logger.warn('Backup também não deu certo, começando do zero mesmo');
        }
    }
    
    // Salva os dados atuais
    async save(state) {
        const data = {
            bumpCount: state.bumpCount,
            remainingTime: state.remainingTime,
            lastSave: new Date().toISOString(), // pra saber quando foi salvo
            version: '2.0' // versão do formato dos dados
        };
        
        try {
            // Primeiro faz backup do arquivo atual
            try {
                await fs.copyFile(this.config.DATA_FILE, this.backupFile);
            } catch {
                // Se não conseguir fazer backup, não é crítico
            }
            
            // Salva os dados novos
            await fs.writeFile(this.config.DATA_FILE, JSON.stringify(data, null, 2));
            Logger.debug('Dados salvos tranquilo');
        } catch (error) {
            Logger.error('Erro ao salvar dados', error);
            throw error;
        }
    }
    
    // Verifica se os dados tão no formato certo
    isValidData(data) {
        return data && 
               typeof data === 'object' && 
               typeof data.bumpCount === 'number' &&
               typeof data.remainingTime === 'number';
    }
}

/**
 * Gerenciador de status do Discord
 * Cuida de atualizar aquele status embaixo do nome do bot
 * Coloquei debounce pra não spammar a API do Discord
 */
class StatusManager {
    constructor(config) {
        this.config = config;
        this.updateTimeout = null; // timeout pra debounce
    }
    
    // Agenda uma atualização (com debounce pra não spammar)
    scheduleUpdate(client, state) {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        
        // Espera 1 segundo antes de atualizar (debounce)
        this.updateTimeout = setTimeout(() => {
            this.update(client, state);
        }, 1000);
    }
    
    // Atualiza o status do bot
    update(client, state) {
        const now = Date.now();
        // Só atualiza se passou tempo suficiente desde a última atualização
        if (now - state.lastUpdateTime < this.config.STATUS_COOLDOWN) {
            return;
        }
        
        try {
            if (!client.user) return; // se não tiver logado ainda
            
            // Calcula minutos e segundos restantes
            const minutes = Math.floor(state.remainingTime / 60);
            const seconds = Math.floor(state.remainingTime % 60);
            
            // Cria o status customizado
            const customStatus = new CustomStatus()
                .setStatus('online')
                .setState(`Próximo bump: ${minutes}m ${seconds}s`)
                .setEmoji('⏰');

            client.user.setPresence(customStatus.toData());
            state.lastUpdateTime = now;
            Logger.debug(`Status atualizado: ${minutes}m ${seconds}s`);
        } catch (error) {
            Logger.error('Erro ao atualizar status', error);
        }
    }
    
    // Inicia o countdown pro próximo bump
    startCountdown(client, state, ms) {
        // Para todos os timers antigos antes de começar
        state.clearAllTimers();
        state.remainingTime = ms / 1000; // converte pra segundos
        
        // Atualiza o status imediatamente
        this.update(client, state);
        
        // Cria o intervalo que roda a cada segundo
        const interval = setInterval(() => {
            state.remainingTime = Math.max(state.remainingTime - 1, 0);
            this.scheduleUpdate(client, state);

            // Para o countdown quando chegar em zero
            if (state.remainingTime <= 0) {
                clearInterval(interval);
                state._intervals.delete(interval);
            }
        }, 1000);
        
        state.addInterval(interval);
    }
}

/**
 * Gerenciador de bumps
 * Aqui é onde a mágica acontece - faz os bumps automáticos
 * Implementei circuit breaker pra não ficar tentando quando tá dando erro
 */
class BumpManager {
    constructor(config) {
        this.config = config;
        this.failures = 0; // quantas falhas consecutivas
        this.maxFailures = 3; // máximo de falhas antes de parar
        this.circuitOpen = false; // se o circuit breaker tá ativo
        this.lastFailure = 0; // quando foi a última falha
        this.circuitResetTime = 300000; // 5min pra resetar o circuit breaker
    }
    
    // Executa um bump
    async perform(channel, state, dataManager) {
        // Verifica se o circuit breaker tá ativo
        if (this.circuitOpen) {
            if (Date.now() - this.lastFailure > this.circuitResetTime) {
                this.circuitOpen = false;
                this.failures = 0;
                Logger.info('Circuit breaker resetado, voltando a tentar bumps');
            } else {
                Logger.warn('Circuit breaker ativo, pulando este bump');
                return false;
            }
        }
        
        // Evita bumps simultâneos
        if (state.isBumping) {
            Logger.warn('Já tá fazendo bump, calma aí');
            return false;
        }
        
        try {
            state.isBumping = true;
            Logger.info('Fazendo bump...');
            
            // Verifica se o bot tem permissão no canal
            if (!channel.permissionsFor(channel.client.user)?.has(['SEND_MESSAGES', 'VIEW_CHANNEL'])) {
                throw new Error('Bot não tem permissão no canal, verifica isso aí');
            }
            
            // Envia o comando /bump pro Disboard
            await channel.sendSlash('302050872383242240', 'bump');
            
            // Incrementa contador e reseta falhas
            state.bumpCount++;
            state.retryCount = 0;
            this.failures = 0;
            
            // Salva os dados atualizados
            await dataManager.save(state);
            Logger.success(`Bump realizado! Total: ${state.bumpCount}`);
            return true;
            
        } catch (error) {
            // Conta mais uma falha
            this.failures++;
            this.lastFailure = Date.now();
            
            // Se passou do limite, ativa o circuit breaker
            if (this.failures >= this.maxFailures) {
                this.circuitOpen = true;
                Logger.error(`Muitas falhas seguidas (${this.failures}), ativando circuit breaker por 5min`);
            }
            
            Logger.error(`Erro ao fazer bump (tentativa ${state.retryCount + 1})`, error);
            
            // Tenta novamente com backoff exponencial
            if (state.retryCount < this.config.MAX_RETRIES) {
                state.retryCount++;
                const backoffTime = this.config.RETRY_DELAY * Math.pow(2, state.retryCount - 1);
                Logger.info(`Tentando novamente em ${backoffTime / 1000}s...`);
                
                await this.sleep(backoffTime);
                return this.perform(channel, state, dataManager);
            }
            
            Logger.error('Esgotei as tentativas, desistindo por enquanto');
            return false;
        } finally {
            state.isBumping = false;
        }
    }
    
    // Agenda o próximo bump
    schedule(channel, state, dataManager, statusManager) {
        // Gera um intervalo aleatório entre min e max
        const randomInterval = Math.floor(
            Math.random() * (this.config.BUMP_MAX_INTERVAL - this.config.BUMP_MIN_INTERVAL + 1)
        ) + this.config.BUMP_MIN_INTERVAL;
        
        Logger.info(`Próximo bump agendado para daqui ${Math.floor(randomInterval / 60000)} minutos`);
        statusManager.startCountdown(channel.client, state, randomInterval);

        // Agenda o timeout pro próximo bump
        const timeout = setTimeout(async () => {
            try {
                const success = await this.perform(channel, state, dataManager);
                if (success) {
                    // Se deu certo, agenda o próximo
                    this.schedule(channel, state, dataManager, statusManager);
                } else {
                    Logger.warn('Bump falhou, reagendando pra daqui 5min...');
                    setTimeout(() => {
                        this.schedule(channel, state, dataManager, statusManager);
                    }, this.config.RESTART_DELAY);
                }
            } catch (error) {
                Logger.error('Erro crítico no agendamento', error);
                setTimeout(() => {
                    this.schedule(channel, state, dataManager, statusManager);
                }, this.config.RESTART_DELAY);
            }
        }, randomInterval);
        
        state.addTimeout(timeout);
    }
    
    // Helper pra aguardar um tempo
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Gerenciador de comandos
 * Por enquanto só tem o !status, mas deixei preparado pra adicionar mais
 * Tem rate limiting pra ninguém spammar os comandos
 */
class CommandManager {
    constructor(config) {
        this.config = config;
        this.cooldowns = new Map(); // cooldown individual dos usuários
        this.rateLimits = new Map(); // rate limit global
    }
    
    // Processa o comando !status
    async handleStatus(message, state) {
        if (message.content !== '!status') return;
        
        // Validações básicas antes de processar
        if (!message.guild || !message.channel) {
            Logger.warn('Comando recebido fora de um servidor válido');
            return;
        }
        
        try {
            // Sistema de rate limiting (5 comandos por minuto por usuário)
            const userId = message.author.id;
            const now = Date.now();
            const userLimits = this.rateLimits.get(userId) || { count: 0, resetTime: now + 60000 };
            
            // Reseta o contador se passou 1 minuto
            if (now > userLimits.resetTime) {
                userLimits.count = 0;
                userLimits.resetTime = now + 60000;
            }
            
            // Verifica se não passou do limite
            if (userLimits.count >= 5) {
                const rateLimitMsg = 'Calma aí! Você já usou muitos comandos. Espera um minutinho.';
                await message.reply({
                    content: rateLimitMsg,
                    failIfNotExists: false
                });
                return;
            }
            
            userLimits.count++;
            this.rateLimits.set(userId, userLimits);
            
            // Verifica se o usuário tem permissão
            const hasPermission = await this.checkPermissions(message);
            if (!hasPermission) return;
            
            // Verifica cooldown individual
            if (!(await this.checkCooldown(message))) return;
            
            // Finalmente envia o status
            await this.sendStatus(message, state);
            
        } catch (error) {
            Logger.error('Erro no comando status', error);
            await this.sendErrorResponse(message);
        }
    }
    
    // Verifica se o usuário pode usar comandos
    async checkPermissions(message) {
        try {
            if (!message.guild) return false;
            
            const member = await message.guild.members.fetch(message.author.id);
            const hasPermission = member.permissions.has('ADMINISTRATOR') || 
                                member.roles.cache.has(this.config.ROLE_ID);
            
            if (!hasPermission) {
                // Tenta mandar DM pro usuário
                await message.author.send('❌ Você não tem permissão pra usar comandos deste bot.').catch(() => {
                    Logger.warn('Não consegui mandar DM pro usuário sem permissão');
                });
                return false;
            }
            
            return true;
        } catch (error) {
            Logger.error('Erro ao verificar permissões', error);
            return false;
        }
    }
    
    // Verifica cooldown do comando
    async checkCooldown(message) {
        const userId = message.author.id;
        const lastUsed = this.cooldowns.get(userId);
        
        if (lastUsed && Date.now() - lastUsed < this.config.COMMAND_COOLDOWN) {
            const remainingTime = Math.ceil((this.config.COMMAND_COOLDOWN - (Date.now() - lastUsed)) / 1000);
            await message.reply({
                content: `⏳ Calma aí, espera mais ${remainingTime}s antes de usar o comando de novo.`,
                failIfNotExists: false
            });
            return false;
        }
        
        this.cooldowns.set(userId, Date.now());
        return true;
    }
    
    // Envia a mensagem com o status do bot
    async sendStatus(message, state) {
        const minutes = Math.floor(state.remainingTime / 60);
        const seconds = Math.floor(state.remainingTime % 60);
        const uptime = process.uptime();
        const uptimeHours = Math.floor(uptime / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);
        const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        
        // Monta a mensagem formatada (discord.js-selfbot não suporta embed)
        const statusText = [
            '```',
            '📊 STATUS DO BOT',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            `👤 Usuário: ${message.client.user.tag}`,
            `📈 Bumps Realizados: ${state.bumpCount}`,
            `⏰ Próximo Bump: ${minutes}m ${seconds}s`,
            `🕐 Online há: ${uptimeHours}h ${uptimeMinutes}m`,
            `💾 Memória: ${memoryUsage}MB`,
            `🔄 Status: ${state.isBumping ? 'Fazendo bump...' : 'Rodando normal'}`,
            `📅 Última Atualização: ${new Date().toLocaleString('pt-BR')}`,
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            'Bot de Bump v2.0 - Feito com ❤️',
            '```'
        ].join('\n');
        
        await message.reply({
            content: statusText,
            failIfNotExists: false
        });
    }
    
    // Resposta quando dá erro no comando
    async sendErrorResponse(message) {
        try {
            const errorMessage = '❌ Deu ruim aqui! Tenta de novo mais tarde.';
            await message.reply({
                content: errorMessage,
                failIfNotExists: false
            });
        } catch (replyError) {
            Logger.error('Não consegui responder o erro no canal', replyError);
            
            // Tenta mandar por DM como último recurso
            try {
                await message.author.send('❌ Deu erro ao processar seu comando.');
            } catch (dmError) {
                Logger.error('Também não consegui mandar DM', dmError);
            }
        }
    }
}

/**
 * Classe principal do bot
 * Aqui é onde tudo se junta e funciona
 * Organizei tudo em métodos pra ficar mais fácil de entender
 */
class DiscordBumpBot {
    constructor() {
        // Inicializa todos os gerenciadores
        this.config = new Config();
        this.state = new AppState();
        this.dataManager = new DataManager(this.config);
        this.statusManager = new StatusManager(this.config);
        this.bumpManager = new BumpManager(this.config);
        this.commandManager = new CommandManager(this.config);
        this.client = null;
        this.isShuttingDown = false; // pra evitar shutdown duplo
    }
    
    // Inicializa o bot
    async initialize() {
        try {
            // Cria o cliente do Discord
            this.client = new Client({
                checkUpdate: false, // não verifica updates automático
                restTimeOffset: 150, // offset pra API
                retryLimit: 5, // tentativas de reconexão
                intents: [] // selfbot não precisa de intents
            });
            
            // Configura os eventos
            this.setupEventHandlers();
            
            // Carrega dados salvos
            await this.dataManager.load(this.state);
            
            Logger.info('Fazendo login no Discord...');
            await this.client.login(this.config.TOKEN);
            
        } catch (error) {
            Logger.error('Erro ao inicializar o bot', error);
            throw error;
        }
    }
    
    // Configura todos os eventos do bot
    setupEventHandlers() {
        // Eventos do Discord
        this.client.on('ready', () => this.onReady());
        this.client.on('messageCreate', (message) => this.onMessage(message));
        this.client.on('error', (error) => Logger.error('Erro no cliente Discord', error));
        this.client.on('disconnect', () => Logger.warn('Bot desconectado'));
        this.client.on('reconnecting', () => Logger.info('Tentando reconectar...'));
        
        // Eventos do sistema (pra fechar o bot graciosamente)
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT')); // Ctrl+C
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM')); // kill
        
        // Tratamento de erros não capturados (importante!)
        process.on('unhandledRejection', (error) => {
            Logger.error('Promise rejeitada não tratada (isso é ruim!)', error);
        });
        
        process.on('uncaughtException', (error) => {
            Logger.error('Exceção não capturada (isso é muito ruim!)', error);
            this.gracefulShutdown('uncaughtException');
        });
    }
    
    // Executado quando o bot conecta no Discord
    async onReady() {
        Logger.success(`Bot conectado como ${this.client.user.tag}`);
        
        try {
            // Busca o canal configurado
            const channel = await this.client.channels.fetch(this.config.BUMP_CHANNEL);
            if (!channel || !channel.isText()) {
                throw new Error('Canal configurado não existe ou não é um canal de texto');
            }
            
            Logger.info(`Canal de bump: ${channel.name} (${channel.guild.name})`);
            
            // Faz o primeiro bump e agenda os próximos
            const success = await this.bumpManager.perform(channel, this.state, this.dataManager);
            if (success) {
                this.bumpManager.schedule(channel, this.state, this.dataManager, this.statusManager);
            } else {
                // Se o primeiro bump falhou, tenta de novo em 5min
                Logger.warn('Primeiro bump falhou, tentando novamente em 5 minutos');
                setTimeout(() => {
                    this.bumpManager.schedule(channel, this.state, this.dataManager, this.statusManager);
                }, this.config.RESTART_DELAY);
            }
            
            // Atualiza o status
            this.statusManager.update(this.client, this.state);
            
        } catch (error) {
            Logger.error('Erro ao inicializar o bot após conexão', error);
            setTimeout(() => process.exit(1), 5000);
        }
    }
    
    // Processa mensagens recebidas
    async onMessage(message) {
        try {
            // Ignora bots e mensagens fora de servidor
            if (message.author.bot || !message.guild) return;
            
            // Processa comandos
            await this.commandManager.handleStatus(message, this.state);
        } catch (error) {
            Logger.error('Erro ao processar mensagem', error);
        }
    }
    
    // Desliga o bot de forma segura
    async gracefulShutdown(signal) {
        if (this.isShuttingDown) return; // evita shutdown duplo
        this.isShuttingDown = true;
        
        Logger.info(`Recebido sinal ${signal}, desligando o bot...`);
        
        try {
            // Para todos os timers
            this.state.clearAllTimers();
            
            // Salva os dados antes de fechar
            await this.dataManager.save(this.state);
            
            // Destrói a conexão com o Discord
            if (this.client) {
                this.client.destroy();
            }
            
            Logger.success('Bot desligado com sucesso!');
            process.exit(0);
        } catch (error) {
            Logger.error('Erro ao desligar o bot', error);
            process.exit(1);
        }
    }
}

// Função principal que inicia tudo
async function main() {
    try {
        Logger.info('🚀 Iniciando bot de bump...');
        const bot = new DiscordBumpBot();
        await bot.initialize();
    } catch (error) {
        Logger.error('Falha crítica ao inicializar o bot', error);
        process.exit(1);
    }
}

// Verifica se o arquivo tá sendo executado diretamente (não importado)
if (require.main === module) {
    main().catch(error => {
        Logger.error('Erro na função main', error);
        process.exit(1);
    });
}

// Exporta as classes pra caso alguém queira importar
module.exports = { DiscordBumpBot, Logger, Config };
