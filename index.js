require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { CustomStatus } = require('discord.js-selfbot-rpc');
const fs = require('fs').promises;

// Configurações centralizadas
const CONFIG = {
    DATA_FILE: './bumpData.txt',
    ROLE_ID: process.env.ADMIN_ROLE_ID || '1262597302212624465',
    STATUS_COOLDOWN: 600000, // 10 minutos
    BUMP_MIN_INTERVAL: 7200000, // 2 horas
    BUMP_MAX_INTERVAL: 9000000, // 2.5 horas
    COMMAND_COOLDOWN: 60000, // 1 minuto
    RETRY_DELAY: 5000, // 5 segundos
    MAX_RETRIES: 3
};

// Estado da aplicação
const state = {
    bumpCount: 0,
    remainingTime: 0,
    countdownInterval: null,
    lastUpdateTime: 0,
    isBumping: false,
    bumpTimeout: null,
    retryCount: 0,
    maxRetries: CONFIG.MAX_RETRIES
};

// Mapa de cooldowns para comandos
const cooldowns = new Map();

/**
 * Gerenciador de dados para persistência
 */
const dataHandler = {
    /**
     * Carrega dados do arquivo
     * @returns {Promise<void>}
     */
    async load() {
        try {
            const data = await fs.readFile(CONFIG.DATA_FILE, 'utf-8');
            if (!data || !data.includes(',')) {
                console.log('📊 Formato de dados inválido, usando valores padrão');
                return;
            }
            
            const [count, time] = data.split(',');
            const parsedCount = parseInt(count);
            const parsedTime = parseInt(time);
            
            if (!isNaN(parsedCount)) {
                state.bumpCount = parsedCount;
            }
            
            if (!isNaN(parsedTime)) {
                state.remainingTime = Math.max(parsedTime, 0);
            }
            
            console.log(`📊 Dados carregados: ${state.bumpCount} bumps, ${state.remainingTime}s restantes`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('❌ Erro ao carregar dados:', error.message);
            } else {
                console.log('💫 Arquivo de dados não encontrado, iniciando com valores padrão');
            }
        }
    },

    /**
     * Salva dados no arquivo
     * @returns {Promise<void>}
     */
    async save() {
        try {
            const data = `${state.bumpCount},${Math.max(state.remainingTime, 0)}`;
            await fs.writeFile(CONFIG.DATA_FILE, data, 'utf-8');
            console.log('💾 Dados salvos com sucesso');
        } catch (error) {
            console.error('❌ Erro ao salvar dados:', error.message);
        }
    }
};

/**
 * Gerenciador de status do Discord
 */
const statusManager = {
    /**
     * Atualiza o status do usuário no Discord
     */
    update() {
        const now = Date.now();
        if (now - state.lastUpdateTime < CONFIG.STATUS_COOLDOWN) return;
        
        try {
            const minutes = Math.floor(state.remainingTime / 60);
            const seconds = Math.floor(state.remainingTime % 60);
            
            const customStatus = new CustomStatus()
                .setStatus('online')
                .setState(`Próximo bump: ${minutes}m ${seconds}s`)
                .setEmoji('⏰');

            client.user.setPresence(customStatus.toData());
            state.lastUpdateTime = now;
        } catch (error) {
            console.error('❌ Erro ao atualizar status:', error.message);
        }
    },

    /**
     * Inicia a contagem regressiva
     * @param {number} ms - Tempo em milissegundos
     */
    startCountdown(ms) {
        if (state.countdownInterval) {
            clearInterval(state.countdownInterval);
        }
        
        state.remainingTime = ms / 1000;
        this.update();
        
        state.countdownInterval = setInterval(() => {
            state.remainingTime = Math.max(state.remainingTime - 1, 0);
            this.update();

            if (state.remainingTime <= 0) {
                clearInterval(state.countdownInterval);
                state.countdownInterval = null;
            }
        }, 1000);
    }
};

/**
 * Gerenciador de bumps
 */
const bumpManager = {
    /**
     * Realiza o bump no canal especificado
     * @param {TextChannel} channel - Canal onde o bump será realizado
     * @returns {Promise<boolean>} - Sucesso ou falha do bump
     */
    async perform(channel) {
        if (state.isBumping) {
            console.log('⚠️ Já existe um bump em andamento');
            return false;
        }
        
        try {
            state.isBumping = true;
            console.log('🔄 Iniciando bump...');
            
            await channel.sendSlash('302050872383242240', 'bump');
            state.bumpCount++;
            state.retryCount = 0;
            await dataHandler.save();
            console.log(`✅ Bump realizado! Total: ${state.bumpCount}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao realizar bump:', error.message);
            
            // Implementação de backoff exponencial
            if (state.retryCount < state.maxRetries) {
                state.retryCount++;
                const backoffTime = CONFIG.RETRY_DELAY * Math.pow(2, state.retryCount - 1);
                console.log(`🔄 Tentativa ${state.retryCount}/${state.maxRetries} em ${backoffTime/1000}s`);
                
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                return this.perform(channel);
            }
            
            console.error('❌ Número máximo de tentativas excedido');
            return false;
        } finally {
            state.isBumping = false;
        }
    },

    /**
     * Agenda o próximo bump
     * @param {TextChannel} channel - Canal onde o bump será realizado
     */
    schedule(channel) {
        const randomInterval = Math.floor(Math.random() * 
            (CONFIG.BUMP_MAX_INTERVAL - CONFIG.BUMP_MIN_INTERVAL + 1)) + CONFIG.BUMP_MIN_INTERVAL;
        
        console.log(`⏱️ Próximo bump agendado para ${Math.floor(randomInterval/60000)} minutos`);
        statusManager.startCountdown(randomInterval);

        if (state.bumpTimeout) {
            clearTimeout(state.bumpTimeout);
        }

        state.bumpTimeout = setTimeout(async () => {
            const success = await this.perform(channel);
            if (success) {
                this.schedule(channel);
            } else {
                console.log('⚠️ Reagendando bump após falha...');
                setTimeout(() => this.schedule(channel), 300000); // 5 minutos
            }
        }, randomInterval);
    }
};

/**
 * Gerenciador de comandos
 */
const commandHandler = {
    /**
     * Processa o comando de status
     * @param {Message} message - Mensagem recebida
     */
    async handleStatus(message) {
        if (message.content !== '!status') return;

        try {
            // Verificar permissões do canal
            if (!message.channel.permissionsFor(client.user)?.has(['SEND_MESSAGES', 'VIEW_CHANNEL'])) {
                console.log(`⚠️ Sem permissões no canal ${message.channel.name}`);
                return;
            }

            // Verificar se o membro existe
            const member = await message.guild?.members.fetch(message.author.id).catch(() => null);
            if (!member) {
                console.log('⚠️ Não foi possível obter informações do membro');
                return;
            }

            // Verificar permissões do usuário
            const hasPermission = member.permissions.has('ADMINISTRATOR') || member.roles.cache.has(CONFIG.ROLE_ID);
            if (!hasPermission) {
                await message.author.send('Você não tem permissão para usar este comando.').catch(() => {
                    console.log('⚠️ Não foi possível enviar mensagem privada ao usuário');
                });
                return;
            }

            // Verificar cooldown (exceto para administradores)
            if (!member.permissions.has('ADMINISTRATOR')) {
                const lastUsed = cooldowns.get(message.author.id);
                if (lastUsed && Date.now() - lastUsed < CONFIG.COMMAND_COOLDOWN) {
                    const remainingTime = Math.ceil((CONFIG.COMMAND_COOLDOWN - (Date.now() - lastUsed)) / 1000);
                    await message.reply({
                        content: `Aguarde ${remainingTime} segundos antes de usar este comando novamente.`,
                        failIfNotExists: false
                    });
                    return;
                }
                cooldowns.set(message.author.id, Date.now());
            }

            // Enviar resposta com status
            const minutes = Math.floor(state.remainingTime / 60);
            const seconds = Math.floor(state.remainingTime % 60);

            await message.reply({
                content: `**Status do Bot:**\n` +
                        `- Usuário: ${client.user.tag}\n` +
                        `- Bumps: ${state.bumpCount}\n` +
                        `- Próximo: ${minutes}m ${seconds}s\n\n` +
                        `//////////////////////////////////////`,
                failIfNotExists: false
            });
        } catch (error) {
            console.error('❌ Erro no comando status:', error.message);
            try {
                await message.reply({
                    content: 'Ocorreu um erro ao processar o comando. Tente novamente mais tarde.',
                    failIfNotExists: false
                });
            } catch (replyError) {
                console.error('❌ Não foi possível responder ao comando:', replyError.message);
            }
        }
    }
};

// Inicialização do cliente Discord
const client = new Client({
    checkUpdate: false,
    restTimeOffset: 150,
    retryLimit: 5
});

// Eventos do cliente
client.on('ready', async () => {
    console.log(`🚀 Bot iniciado como ${client.user.tag}`);
    await dataHandler.load();

    try {
        // Verificar se o ID do canal está definido
        if (!process.env.BUMP_CHANNEL) {
            throw new Error('ID do canal de bump não definido no .env');
        }
        
        const channel = await client.channels.fetch(process.env.BUMP_CHANNEL);
        if (!channel) {
            throw new Error('Canal não encontrado');
        }

        console.log(`📣 Canal de bump configurado: ${channel.name}`);
        await bumpManager.perform(channel);
        bumpManager.schedule(channel);
        statusManager.update();
    } catch (error) {
        console.error('❌ Erro na inicialização:', error.message);
        console.log('⚠️ Tentando reiniciar em 5 minutos...');
        setTimeout(() => process.exit(1), 300000); // Força reinício após 5 minutos
    }
});

client.on('messageCreate', commandHandler.handleStatus);

// Tratamento de erros global
process.on('unhandledRejection', error => {
    console.error('❌ Erro não tratado (Promise):', error.message);
    console.error(error.stack);
});

process.on('uncaughtException', error => {
    console.error('❌ Exceção não capturada:', error.message);
    console.error(error.stack);
    
    // Em caso de erro crítico, salvar dados antes de encerrar
    dataHandler.save().finally(() => {
        console.log('⚠️ Encerrando após erro crítico. Reinicie o bot manualmente.');
        setTimeout(() => process.exit(1), 5000);
    });
});

client.on('error', error => {
    console.error('❌ Erro no cliente Discord:', error.message);
});

// Tratamento de encerramento gracioso
process.on('SIGINT', async () => {
    console.log('🛑 Recebido sinal de interrupção, encerrando...');
    await dataHandler.save();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Recebido sinal de término, encerrando...');
    await dataHandler.save();
    process.exit(0);
});

// Login no Discord
console.log('🔑 Tentando login no Discord...');
client.login(process.env.TOKEN).catch(error => {
    console.error('❌ Falha ao fazer login:', error.message);
    process.exit(1);
});
