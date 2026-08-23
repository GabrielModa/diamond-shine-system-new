# Diamond Shine — roteiro de teste local

Este roteiro valida os dois lados do mesmo fluxo: quem executa no app de campo e quem gerencia no painel web.

## Preparar o ambiente

1. Na raiz do projeto, copie `.env.example` para `.env` e defina uma `DATABASE_URL` PostgreSQL local.
2. Instale as dependências com `npm ci`.
3. Aplique o banco e carregue os cenários demonstrativos com `npm run db:setup`.
4. Inicie o painel com `npm run dev` e abra `http://localhost:3000`.

Contas de demonstração locais:

| Papel | Login | Senha |
| --- | --- | --- |
| Administrador | `admin@ds.ie` | `password123` |
| Supervisor | `super@ds.ie` | `password123` |
| Funcionário de campo | `employee@ds.ie` | `password123` |
| Leitura | `viewer@ds.ie` | `password123` |

Essas contas são exclusivas do seed local. Nunca publique essa senha.

## Fluxo gerencial — web

1. Entre como **admin** e comece em **Overview**. A fila de atenção deve levar diretamente a exceções de campo, inspeções de qualidade e pedidos de material. Em **Clients**, pesquise um cliente e abra o seu histórico operacional; em **Work orders**, confira o contrato, local, plano, próximas visitas e equipa sem misturar isso com as telas legadas.
2. Em **Service setup**, crie ou selecione um cliente, um local e áreas; depois associe contrato e plano de serviço. Publique o plano e crie um job recorrente em **Schedule**. Use **Find a time** para comparar janelas por duração e equipa antes de abrir a criação do trabalho. A área **Assignment guard** mostra indisponibilidades declaradas; tente atribuir um membro indisponível para confirmar que o sistema bloqueia a agenda antes da publicação.
3. Em **Supplies**, faça uma contagem baixa de um item. Confirme que surge uma solicitação de reposição com o local, o item, prioridade e histórico. Atualize-a pelo ciclo `Requested → Triaged → Approved → Ordered → In transit → Delivered`.
4. Em **Field control**, acompanhe o início/fim, distância/GPS, checklist, fotos e incidentes. Em **Timesheets**, use a aba de revisão para aprovar a prova de uma visita concluída ou enviá-la para rework com nota; confirme que a conclusão original continua registrada e o funcionário vê o pedido de correção no app. Use **Quality** para registrar inspeção, ação corretiva e rework; marque uma inspeção como **Client-safe report** e abra o relatório para validar a visão compartilhável, sem dados internos da equipa.
5. Em **Intelligence**, confirme que as exceções têm motivo, responsável e link de retorno ao dado de origem. Em **Inbox**, publique uma alteração de agenda ou instrução crítica e acompanhe a confirmação.

## Fluxo do funcionário — mobile

1. Em `apps/mobile`, copie `.env.example` para `.env.local` e configure `EXPO_PUBLIC_API_URL` com uma URL HTTPS alcançável pelo aparelho. Para teste em rede local, use o IP da máquina na mesma rede, por exemplo `http://192.168.x.x:3000` apenas em ambiente de desenvolvimento.
2. Execute `npm run start` dentro de `apps/mobile`, abra no Expo Go ou em um simulador e entre como `employee@ds.ie`.
3. Em **Today**, valide o resumo e a próxima visita. Em **Schedule**, confira a agenda salva. Em **Work**, abra o pacote da visita, confirme ou recuse a atribuição e veja problemas pendentes.
4. Na visita, inicie o timer, complete tarefas com `Done`, `N/A` ou `Problem`, tire uma foto de prova, registre incidente e reporte materiais. Faça uma contagem ou pedido de material e confirme que ele aparece no web em **Supplies**.
5. Em **Time**, teste visita, deslocamento, office, supplies, break e general. Desligue a rede, faça uma mudança, confira o aviso de pendência e religue a rede para sincronizar.
6. Em **More**, valide Inbox, **My availability**, **Location & time records**, status de sincronização e logout do dispositivo. Em Location & time, confirme que aparecem somente horário, classe/distância/precisão do evento — não coordenadas cruas — e envie uma contestação. No web, abra **Field control → Time review**, responda à contestação e confirme que a decisão retorna ao funcionário.
7. Declare uma indisponibilidade e confirme, no web, que a agenda bloqueia nova atribuição nesse período.

## Verificação automática

Na raiz do projeto:

```bash
npm run verify
```

O comando cobre TypeScript, lint, testes unitários e de integração, build web, export do app móvel e jornadas E2E desktop/mobile. Antes de rodar E2E em uma instalação nova, execute `npx playwright install chromium` e carregue o seed com `npm run db:seed`.

## Critérios de aceite da demonstração

- Um pedido de material feito no campo chega em Supplies, tem responsável/estado e não duplica para o mesmo risco.
- Uma visita agendada aparece para o funcionário, alterações pedem confirmação e a execução deixa provas auditáveis.
- GPS fraco ou trabalho offline não bloqueiam o funcionário: tornam-se eventos revisáveis.
- Problema, incidente, qualidade e retrabalho nunca ficam presos em chat; todos têm dono e próxima ação.
- Um relatório partilhável com o cliente mostra o resultado e os próximos passos, sem expor GPS, identidade dos funcionários, notas ou evidências internas.
- Gestor revisa exceções primeiro, sem precisar procurar pinos de mapa ou montar a história em mensagens.
- Funcionário consegue ver e contestar um evento de localização/horas pelo próprio aplicativo, e a resposta fica registrada no fluxo operacional.
