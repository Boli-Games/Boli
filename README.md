# Boli

Escondite en primera persona. Un cazador entre la manada; el resto de los jugadores se hacen los bolis. Podés jugar solo o en una partida privada con amigos.

## Cómo se gana

Los infiltrados ganan **sobreviviendo 10 minutos** o completando la misión secreta (techo, mesa, loma). El cazador gana cuando no queda ningún infiltrado en pie.

Disparar es una apuesta: 8 cartuchos, 3 impactos para tumbar, −20 HP si le pegás a un NPC y −30 extra si lo tumbás. Hay 3 cajas de munición en el mapa.

## Menú

- **Jugar solo** — un infiltrado y un cazador con Tab para cambiar de rol.
- **Crear partida privada** — código de 4 letras. Al empezar se sortea 1 cazador y el resto infiltrados.
- **Unirse** — el código, o un link `?room=K7MQ`.

En online, Tab no cambia el rol.

## Controles

- **Clic**: capturar el mouse (cazador: disparar)
- **WASD**: caminar
- **Shift**: modo boli
- **Espacio**: volver al menú

## Desarrollo

```bash
npm install
npm run party:dev
npm run dev
```

`party:dev` (Wrangler) levanta las salas en `127.0.0.1:8787`. En producción el cliente usa `VITE_PARTYKIT_HOST`.
