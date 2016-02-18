"use strict";
let Board = require("../configs/board");
let ServerConfig = require("../configs/server-config");

let ColorService = require("../services/color-service");
let GameControlsService = require("../services/game-controls-service");
let CoordinateService = require("../services/coordinate-service");
let NameService = require("../services/name-service");

let Food = require("../models/food");
let Player = require("../models/player");
let ScoreBoard = require("../models/score-board");

class GameController {
    constructor(io) {
        this.currentFPS = ServerConfig.DEFAULT_FPS;
        this.players = {};
        this.food = [];
        for(let i = 0; i < ServerConfig.DEFAULT_FOOD_AMOUNT; i++) {
            this.generateFood();
        }
        this.colorService = new ColorService();
        this.nameService = new NameService();
        this.scoreBoard = new ScoreBoard();
        
        this.io = io;
        let self = this;
        this.io.sockets.on(ServerConfig.IO.DEFAULT_CONNECTION, function (socket) {
            socket.on(ServerConfig.IO.INCOMING.NEW_PLAYER, self._addPlayer.bind(self, socket));
            socket.on(ServerConfig.IO.INCOMING.NAME_CHANGE, self._changePlayerName.bind(self, socket));
            socket.on(ServerConfig.IO.INCOMING.KEY_DOWN, self._keyDown.bind(self, socket));
            socket.on(ServerConfig.IO.INCOMING.FOOD_CHANGE, self._changeFood.bind(self, socket));
            socket.on(ServerConfig.IO.INCOMING.SPEED_CHANGE, self._changeSpeed.bind(self, socket));
            socket.on(ServerConfig.IO.INCOMING.DISCONNECT, self._disconnect.bind(self, socket));
        });
    }
    
    runGameCycle() {
        // Pause the game if there aren't any players
        if(Object.keys(this.players).length === 0){
            console.log("Game Paused");
            return;
        }
        
        for(let playerId in this.players) {
            this.players[playerId].move();
        }
        
        let losingPlayers = [];
        for(let playerId in this.players) {
            let player = this.players[playerId];
            if(this.hasPlayerLost(player)) {
                losingPlayers.push(player);
                continue;
            }
            
            let playerAteFood = false;
            for(let i = 0; i < this.food.length; i++) {
                if(this.food[i].location.equals(player.getHeadLocation())) {
                    this.food.splice(i, 1);
                    playerAteFood = true;
                    break;
                }
            }
            
            if(playerAteFood){
                player.growNextTurn();
                this.scoreBoard.increaseScore(player.id);
                this.generateFood();
                break;
            }
        }
        
        for(let lostPlayer of losingPlayers) {
            lostPlayer.reset();
            this.scoreBoard.resetScore(lostPlayer.id);
        }
    
        let gameData = {
            players: this.players,
            food: this.food,
            scoreBoard: this.scoreBoard,
            speed: this.currentFPS
        };
        this.io.sockets.emit(ServerConfig.IO.OUTGOING.NEW_STATE, gameData );
        
        setTimeout(this.runGameCycle.bind(this), 1000/this.currentFPS);
    }
    
    generateFood() {
        let food = new Food(CoordinateService.getUnoccupiedCoordinate(this.food, this.players), ServerConfig.FOOD_COLOR);
        this.food.push(food);
    }
    
    hasPlayerLost(player) {
        return player.hasCollidedWithSelf() || 
               CoordinateService.isOutOfBounds(player.getHeadLocation()) ||
               CoordinateService.hasPlayerCollidedWithAnotherPlayer(player, this.players);
    }
    
    sendNotificationToPlayers(notification) {
        console.log(notification);
        this.io.sockets.emit(ServerConfig.IO.OUTGOING.NOTIFICATION, notification );
    }
    
    /*******************************
     *  socket.io handling methods *
     *******************************/
    
    _addPlayer(socket) {
        let playerName = this.nameService.getPlayerName();
        let playerColor = this.colorService.getColor();
        let newPlayer = new Player(socket.id, playerName, playerColor);
        this.players[socket.id] = newPlayer;
        this.scoreBoard.addPlayer(newPlayer.id, playerName, playerColor);
        socket.emit(ServerConfig.IO.OUTGOING.NEW_PLAYER_INFO, playerName, playerColor);
        socket.emit(ServerConfig.IO.OUTGOING.BOARD_INFO, Board);
        this.sendNotificationToPlayers(playerName + " has joined!");
        // Start game if the first player has joined
        if(Object.keys(this.players).length === 1) {
            console.log("Game Started");
            this.runGameCycle();
        }
    }
    
    _changePlayerName(socket, newPlayerName) {
        let player = this.players[socket.id];
        let oldPlayerName = player.name;
        if(this.nameService.doesPlayerNameExist(newPlayerName)) {
            socket.emit(ServerConfig.IO.OUTGOING.NEW_PLAYER_INFO, oldPlayerName, player.color);
            this.sendNotificationToPlayers(player.name + " couldn't claim the name " + newPlayerName);
        } else {
            this.sendNotificationToPlayers(oldPlayerName + " is now known as " + newPlayerName);
            player.name = newPlayerName;
            this.nameService.usePlayerName(newPlayerName);
            this.scoreBoard.changePlayerName(player.id, newPlayerName);
        }
    }
    
    _changeFood(socket, foodOption) {
        let notification = this.players[socket.id].name;
        if(foodOption === ServerConfig.FOOD_CHANGE.INCREASE) {
            this.generateFood();
            notification += " has added some food.";
        } else if(foodOption === ServerConfig.FOOD_CHANGE.DECREASE) {
            if(this.food.length > 0) {
                this.food.pop();
                notification += " has removed some food.";
            } else {
                notification += " couldn't remove food.";
            }
        } else if(foodOption === ServerConfig.FOOD_CHANGE.RESET) {
            while(this.food.length > ServerConfig.DEFAULT_FOOD_AMOUNT) {
                this.food.pop();
            }
            notification += " has reset the food.";
        }
        this.sendNotificationToPlayers(notification);
    }
    
    _changeSpeed(socket, speedOption) {
        let notification = this.players[socket.id].name;
        if(speedOption === ServerConfig.SPEED_CHANGE.INCREASE) {
            if(this.currentFPS < ServerConfig.MAX_FPS) {
                notification += " has raised the game speed.";
                this.currentFPS++;
            } else {
                notification += " tried to raised the game speed past the limit.";
            }
        } else if(speedOption === ServerConfig.SPEED_CHANGE.DECREASE) {
            if(this.currentFPS > ServerConfig.DEFAULT_FPS) {
                notification += " has lowered the game speed.";
                this.currentFPS--;
            } else {
                notification += " tried to lower the game speed past the limit.";
            }
        } else if(speedOption === ServerConfig.SPEED_CHANGE.RESET) {
            notification += " has reset the game speed.";
            this.currentFPS = ServerConfig.DEFAULT_FPS;
        }
        this.sendNotificationToPlayers(notification);
    }
    
    _disconnect(socket) {
        let player = this.players[socket.id];
        if(!player) {
            return;
        }
        this.sendNotificationToPlayers(this.players[socket.id].name + " has left.");
        this.colorService.returnColor(player.color);
        this.nameService.returnPlayerName(player.name);
        this.scoreBoard.removePlayer(player.id);
        delete this.players[socket.id];
    }
    
    _keyDown(socket, keyCode) {
        GameControlsService.handleKeyDown(this.players[socket.id], keyCode);
    }
}

module.exports = GameController;