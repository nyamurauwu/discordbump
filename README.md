# Discord Auto Bump Selfbot

Um selfbot que automaticamente faz bump no Disboard.

# AVISO
Selfbots são contra os Termos de Serviço do Discord.
Que podem ser encontrados em https://discord.com/guidelines e https://discord.com/terms

Este código é estritamente educacional.

Não me responsabilizo por contas que sejam moderadas pelo Discord devido ao uso deste selfbot.

# Configuração
Abra **.env**:


Cole o token da sua conta alternativa depois de **TOKEN=**

Cole o ID do canal onde você quer que o bot envie **/bump** depois de **BUMP_CHANNEL=**
Não esqueça do **guild_id=** e o id do seu servidor

# Como obter o token do usuário
1. Abra o Discord
2. Pressione `CTRL+SHIFT+I` para abrir o Console de Desenvolvedor
3. Copie e cole o código abaixo no console para automaticamente copiar seu token de usuário para a área de transferência.
```js
window.webpackChunkdiscord_app.push([
  [Math.random()],
  {},
  req => {
    if (!req.c) {
      console.error('req.c is undefined or null');
      return;
    }

    for (const m of Object.keys(req.c)
      .map(x => req.c[x].exports)
      .filter(x => x)) {
      if (m.default && m.default.getToken !== undefined) {
        return copy(m.default.getToken());
      }
      if (m.getToken !== undefined) {
        return copy(m.getToken());
      }
    }
  },
]);
console.log('%cWorked!', 'font-size: 50px');
console.log(`%cYou now have your token in the clipboard!`, 'font-size: 16px');
