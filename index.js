require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { CustomStatus } = require('discord.js-selfbot-rpc');const fs = require('fs');
const client = new Client();

// Arquivo de dados para persistência
const DATA_FILE = './bumpData.txt';

let bumpCount = 0; // Contador de bumps
let remainingTime = 0; // Tempo restante até o próximo bump em segundos
let countdownInterval; // Variável global para armazenar o setInterval
const cooldowns = new Map(); // Mapa para rastrear o cooldown dos usuários
const ROLE_ID = '1262597302212624465'; // Substitua pelo ID do cargo específico que pode usar o comando

// Função para ler os dados do arquivo de persistência
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf-8');
            const [count, time] = data.split(',');
            bumpCount = parseInt(count) || 0;
            remainingTime = Math.max(parseInt(time) || 0, 0); // Garante que não seja negativo
            console.log(`Dados carregados: ${bumpCount} bumps.`);
        } else {
            console.log('Arquivo de dados não encontrado, usando valores padrão.');
        }
    } catch (error) {
        console.error('Erro ao carregar os dados:', error);
    }
}

// Função para salvar os dados no arquivo
function saveData() {
    try {
        const data = `${bumpCount},${Math.max(remainingTime, 0)}`;
        fs.writeFileSync(DATA_FILE, data, 'utf-8');
        console.log('Dados salvos no arquivo.');
    } catch (error) {
        console.error('Erro ao salvar os dados:', error);
    }
}

let lastUpdateTime = 0;
const COOLDOWN = 180000; // 3 minutes in milliseconds

function updateCustomStatus() {
    const now = Date.now();
    if (now - lastUpdateTime < COOLDOWN) return;
    
    const minutes = Math.floor(remainingTime / 60);
    const seconds = Math.floor(remainingTime % 60);
    
    const customStatus = new CustomStatus()
        .setStatus('online')
        .setState(`Próximo bump: ${minutes}m ${seconds}s`)
        .setEmoji('⏰');

    client.user.setPresence(customStatus.toData());
    lastUpdateTime = now;
}

function startCountdown(ms) {
    remainingTime = ms / 1000;

    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdownInterval = setInterval(() => {
        remainingTime = Math.max(remainingTime - 1, 0);
        updateCustomStatus();

        if (remainingTime <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            remainingTime = 0;
        }
    }, 1000);
}
client.on('ready', async () => {
    console.log(`Login as ${client.user.tag}`);
    
    loadData(); // Carrega os dados no início

    const channel = await client.channels.fetch(process.env.BUMP_CHANNEL);

    async function bump() {
        await channel.sendSlash('302050872383242240', 'bump');
        bumpCount++; // Incrementa o contador de bumps
        console.log(`Bumped! Total de bumps: ${bumpCount}`);
        saveData(); // Salva os dados após cada bump
    }

    function loop() {
        const randomNum = Math.floor(Math.random() * (9000000 - 7200000 + 1)) + 7200000;
        startCountdown(randomNum);

        setTimeout(() => {
            bump();
            loop();
        }, randomNum); // Intervalo aleatório ajustado
    }

    bump();
    loop();
    updateCustomStatus();
});

// Comando !status com cooldown e verificação de permissões
client.on('messageCreate', async (message) => {
    if (message.content === '!status') {
        const userId = message.author.id;
        const now = Date.now();
        const cooldownTime = 60 * 1000; // Cooldown de 1 minuto
        const member = await message.guild.members.fetch(userId); // Uso de fetch para garantir que o membro esteja no cache

        // Verifica se o usuário possui permissão de administrador ou um cargo específico
        if (!member.permissions.has('ADMINISTRATOR') && !member.roles.cache.has(ROLE_ID)) {
            console.log(`Tentativa de uso do comando !status por ${message.author.tag} (ID: ${userId}) - Sem permissão.`);
            return;
        }

        // Se o usuário for um administrador, não aplica cooldown
        if (!member.permissions.has('ADMINISTRATOR')) {
            // Verifica se o usuário está em cooldown
            if (cooldowns.has(userId)) {
                const lastUsed = cooldowns.get(userId);
                const timeSinceLastUse = now - lastUsed;

                if (timeSinceLastUse < cooldownTime) {
                    const remainingCooldown = Math.ceil((cooldownTime - timeSinceLastUse) / 1000);
                    console.log(`Usuário ${message.author.tag} (ID: ${userId}) tentou usar o comando em cooldown. Faltam ${remainingCooldown}s.`);
                    return;
                }
            }

            // Atualiza o cooldown do usuário
            cooldowns.set(userId, now);
        }

        console.log(`Comando !status usado por ${message.author.tag} (ID: ${userId})`);

        const minutes = Math.floor(remainingTime / 60);
        const seconds = Math.floor(remainingTime % 60);

        // Responde no chat com o status e a mensagem personalizada
        message.reply(
            `**Status do Bot:**\n` +
            `- Usuário logado: ${client.user.tag}\n` +
            `- Total de bumps: ${bumpCount}\n` +
            `- Próximo bump em: ${minutes}m ${seconds}s\n\n` +
            `insira sua mensagem aqui`
        );
    }
});

client.login(process.env.TOKEN);

process.noDeprecation = true;
