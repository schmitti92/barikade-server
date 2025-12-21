
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const COLORS = ["blue", "red", "green", "yellow"];
const now = () => Date.now();
const rid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// Embedded default board (from your board.json)
const DEFAULT_BOARD = {"nodes": [{"id": "n_1", "x": 680.0, "y": -20.0, "kind": "board", "flags": {"run": false, "goal": true, "startColor": null, "noBarricade": false}}, {"id": "n_2", "x": 680.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_3", "x": 720.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_4", "x": 760.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_5", "x": 800.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_6", "x": 840.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_7", "x": 880.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_8", "x": 920.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_9", "x": 960.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_10", "x": 1000.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_11", "x": 1000.0, "y": 60.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_12", "x": 1000.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_13", "x": 960.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_14", "x": 920.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_15", "x": 880.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_16", "x": 840.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_17", "x": 800.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_18", "x": 760.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_19", "x": 720.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_20", "x": 680.0, "y": 100.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_21", "x": 640.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_22", "x": 600.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_23", "x": 560.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_24", "x": 520.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_25", "x": 480.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_26", "x": 440.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_27", "x": 400.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_28", "x": 360.0, "y": 20.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_29", "x": 360.0, "y": 60.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_30", "x": 360.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_31", "x": 400.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_32", "x": 440.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_33", "x": 480.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_34", "x": 520.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_35", "x": 560.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_36", "x": 600.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_37", "x": 640.0, "y": 100.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_38", "x": 680.0, "y": 140.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_39", "x": 680.0, "y": 180.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_40", "x": 640.0, "y": 180.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_41", "x": 600.0, "y": 180.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_42", "x": 600.0, "y": 220.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_43", "x": 600.0, "y": 260.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_44", "x": 560.0, "y": 260.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_45", "x": 520.0, "y": 260.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_46", "x": 520.0, "y": 300.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_47", "x": 520.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_48", "x": 480.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_49", "x": 440.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_50", "x": 440.0, "y": 380.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_51", "x": 440.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_52", "x": 400.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_53", "x": 360.0, "y": 420.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_54", "x": 360.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_55", "x": 360.0, "y": 460.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_56", "x": 400.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_57", "x": 440.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": "red", "noBarricade": true}}, {"id": "n_58", "x": 480.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_59", "x": 520.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_60", "x": 520.0, "y": 460.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_61", "x": 520.0, "y": 420.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_62", "x": 480.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_63", "x": 560.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_64", "x": 600.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": "yellow", "noBarricade": true}}, {"id": "n_65", "x": 640.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_66", "x": 680.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_67", "x": 680.0, "y": 460.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_68", "x": 680.0, "y": 420.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_69", "x": 640.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_70", "x": 600.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_71", "x": 560.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_72", "x": 560.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_73", "x": 600.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_74", "x": 600.0, "y": 380.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_75", "x": 640.0, "y": 260.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_76", "x": 680.0, "y": 260.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_77", "x": 720.0, "y": 260.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_78", "x": 760.0, "y": 260.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_79", "x": 640.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_80", "x": 680.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_81", "x": 720.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_82", "x": 760.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_83", "x": 760.0, "y": 380.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_84", "x": 760.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_85", "x": 720.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_86", "x": 720.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_87", "x": 760.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": "green", "noBarricade": true}}, {"id": "n_88", "x": 800.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_89", "x": 840.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_90", "x": 840.0, "y": 460.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_91", "x": 840.0, "y": 420.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_92", "x": 800.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_93", "x": 800.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_94", "x": 800.0, "y": 260.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_95", "x": 720.0, "y": 180.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_96", "x": 760.0, "y": 180.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_97", "x": 760.0, "y": 220.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_98", "x": 840.0, "y": 260.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_99", "x": 840.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_100", "x": 840.0, "y": 300.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_101", "x": 880.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_102", "x": 920.0, "y": 340.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_103", "x": 920.0, "y": 380.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_104", "x": 920.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_105", "x": 880.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_106", "x": 880.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_107", "x": 920.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": "blue", "noBarricade": true}}, {"id": "n_108", "x": 960.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_109", "x": 1000.0, "y": 500.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_110", "x": 1000.0, "y": 460.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": true}}, {"id": "n_111", "x": 1000.0, "y": 420.0, "kind": "board", "flags": {"run": true, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "n_112", "x": 960.0, "y": 420.0, "kind": "board", "flags": {"run": false, "goal": false, "startColor": null, "noBarricade": false}}, {"id": "h_green_1", "x": 780.0, "y": 600.0, "kind": "house", "flags": {"houseColor": "green", "houseSlot": 1}}, {"id": "h_green_2", "x": 740.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "green", "houseSlot": 2}}, {"id": "h_green_3", "x": 820.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "green", "houseSlot": 3}}, {"id": "h_green_4", "x": 740.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "green", "houseSlot": 4}}, {"id": "h_green_5", "x": 820.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "green", "houseSlot": 5}}, {"id": "h_yellow_1", "x": 600.0, "y": 600.0, "kind": "house", "flags": {"houseColor": "yellow", "houseSlot": 1}}, {"id": "h_yellow_2", "x": 560.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "yellow", "houseSlot": 2}}, {"id": "h_yellow_3", "x": 640.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "yellow", "houseSlot": 3}}, {"id": "h_yellow_4", "x": 560.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "yellow", "houseSlot": 4}}, {"id": "h_yellow_5", "x": 640.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "yellow", "houseSlot": 5}}, {"id": "h_red_1", "x": 420.0, "y": 600.0, "kind": "house", "flags": {"houseColor": "red", "houseSlot": 1}}, {"id": "h_red_2", "x": 380.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "red", "houseSlot": 2}}, {"id": "h_red_3", "x": 460.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "red", "houseSlot": 3}}, {"id": "h_red_4", "x": 380.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "red", "houseSlot": 4}}, {"id": "h_red_5", "x": 460.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "red", "houseSlot": 5}}, {"id": "h_blue_1", "x": 920.0, "y": 600.0, "kind": "house", "flags": {"houseColor": "blue", "houseSlot": 1}}, {"id": "h_blue_2", "x": 880.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "blue", "houseSlot": 2}}, {"id": "h_blue_3", "x": 960.0, "y": 560.0, "kind": "house", "flags": {"houseColor": "blue", "houseSlot": 3}}, {"id": "h_blue_4", "x": 880.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "blue", "houseSlot": 4}}, {"id": "h_blue_5", "x": 960.0, "y": 640.0, "kind": "house", "flags": {"houseColor": "blue", "houseSlot": 5}}], "edges": [["n_56", "n_58"], ["n_1", "n_2"], ["n_2", "n_21"], ["n_21", "n_22"], ["n_22", "n_23"], ["n_23", "n_24"], ["n_24", "n_25"], ["n_25", "n_26"], ["n_26", "n_27"], ["n_27", "n_28"], ["n_28", "n_29"], ["n_29", "n_30"], ["n_30", "n_31"], ["n_31", "n_32"], ["n_32", "n_33"], ["n_33", "n_34"], ["n_34", "n_35"], ["n_35", "n_36"], ["n_36", "n_37"], ["n_20", "n_37"], ["n_19", "n_20"], ["n_18", "n_19"], ["n_16", "n_17"], ["n_15", "n_16"], ["n_14", "n_15"], ["n_13", "n_14"], ["n_12", "n_13"], ["n_11", "n_12"], ["n_10", "n_11"], ["n_10", "n_9"], ["n_8", "n_9"], ["n_7", "n_8"], ["n_6", "n_7"], ["n_5", "n_6"], ["n_4", "n_5"], ["n_3", "n_4"], ["n_2", "n_3"], ["n_20", "n_38"], ["n_38", "n_39"], ["n_39", "n_95"], ["n_95", "n_96"], ["n_96", "n_97"], ["n_78", "n_97"], ["n_77", "n_78"], ["n_76", "n_77"], ["n_75", "n_76"], ["n_43", "n_75"], ["n_42", "n_43"], ["n_41", "n_42"], ["n_40", "n_41"], ["n_39", "n_40"], ["n_78", "n_94"], ["n_94", "n_98"], ["n_100", "n_98"], ["n_100", "n_99"], ["n_93", "n_99"], ["n_46", "n_47"], ["n_45", "n_46"], ["n_44", "n_45"], ["n_43", "n_44"], ["n_47", "n_48"], ["n_48", "n_49"], ["n_49", "n_50"], ["n_50", "n_51"], ["n_51", "n_62"], ["n_61", "n_62"], ["n_61", "n_71"], ["n_70", "n_71"], ["n_70", "n_74"], ["n_73", "n_74"], ["n_73", "n_79"], ["n_79", "n_80"], ["n_80", "n_81"], ["n_81", "n_82"], ["n_82", "n_83"], ["n_83", "n_84"], ["n_84", "n_85"], ["n_68", "n_85"], ["n_68", "n_69"], ["n_69", "n_70"], ["n_47", "n_72"], ["n_72", "n_73"], ["n_82", "n_93"], ["n_101", "n_99"], ["n_101", "n_102"], ["n_102", "n_103"], ["n_103", "n_104"], ["n_104", "n_105"], ["n_105", "n_91"], ["n_91", "n_92"], ["n_84", "n_92"], ["n_104", "n_112"], ["n_111", "n_112"], ["n_109", "n_111"], ["n_108", "n_109"], ["n_107", "n_108"], ["n_106", "n_107"], ["n_106", "n_89"], ["n_89", "n_90"], ["n_90", "n_91"], ["n_88", "n_89"], ["n_87", "n_88"], ["n_86", "n_87"], ["n_66", "n_86"], ["n_66", "n_67"], ["n_67", "n_68"], ["n_65", "n_66"], ["n_64", "n_65"], ["n_63", "n_64"], ["n_59", "n_63"], ["n_59", "n_60"], ["n_60", "n_61"], ["n_58", "n_59"], ["n_57", "n_58"], ["n_56", "n_57"], ["n_54", "n_56"], ["n_53", "n_55"], ["n_52", "n_53"], ["n_51", "n_52"], ["n_17", "n_18"], ["n_109", "n_110"], ["n_110", "n_111"]], "barricades": [], "startNodes": {"red": "n_57", "blue": "n_107", "green": "n_87", "yellow": "n_64"}, "forbiddenBarricadeNodes": ["n_1", "n_54", "n_55", "n_56", "n_57", "n_58", "n_59", "n_60", "n_63", "n_64", "n_65", "n_66", "n_67", "n_86", "n_87", "n_88", "n_89", "n_90", "n_106", "n_107", "n_108", "n_109", "n_110", "h_green_1", "h_green_2", "h_green_3", "h_green_4", "h_green_5", "h_yellow_1", "h_yellow_2", "h_yellow_3", "h_yellow_4", "h_yellow_5", "h_red_1", "h_red_2", "h_red_3", "h_red_4", "h_red_5", "h_blue_1", "h_blue_2", "h_blue_3", "h_blue_4", "h_blue_5"], "goalNode": "n_1"};

function makeInitialRoom(code, hostSocketId) {
  const board = JSON.parse(JSON.stringify(DEFAULT_BOARD));
  return {
    code,
    createdAt: now(),
    hostSocketId,
    started: false,
    phase: "LOBBY",
    turn: {
      activeColor: null,
      step: "ROLL",
      roll: null,
      lastRoll: null,
      lastAction: null,
    },
    players: {},
    spectators: {},
    pieces: {
      blue: [null,null,null,null],
      red: [null,null,null,null],
      green: [null,null,null,null],
      yellow: [null,null,null,null],
    },
    board,
    pendingBarricadeFrom: null,
  };
}

function roomSnapshot(room) {
  const players = {};
  for (const c of COLORS) {
    const p = room.players[c];
    players[c] = p ? { color: c, connected: !!p.connected, taken: true } : { color: c, connected: false, taken: false };
  }
  return {
    code: room.code,
    phase: room.phase,
    started: room.started,
    hostSocketId: room.hostSocketId,
    players,
    pieces: room.pieces,
    board: room.board,
    turn: room.turn,
    pendingBarricadeFrom: room.pendingBarricadeFrom,
    serverTs: now(),
  };
}

function broadcast(room, msg) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    if (client.__roomCode === room.code) client.send(payload);
  }
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function isHost(ws, room) { return ws && room && ws.__socketId === room.hostSocketId; }
function playerColorFor(ws, room) {
  for (const c of COLORS) {
    const p = room.players[c];
    if (p && p.socketId === ws.__socketId) return c;
  }
  return null;
}
function isMyTurn(ws, room) {
  const c = playerColorFor(ws, room);
  return c && room.turn.activeColor === c;
}
function countTakenPlayers(room) {
  let n = 0;
  for (const c of COLORS) if (room.players[c]) n++;
  return n;
}
function nextColor(room, current) {
  const taken = COLORS.filter(c => room.players[c]);
  if (taken.length === 0) return null;
  if (!current) return taken[0];
  const idx = taken.indexOf(current);
  return taken[(idx + 1) % taken.length];
}

// Graph helpers (string ids)
function neighbors(board) {
  const map = new Map();
  for (const n of board.nodes) map.set(n.id, []);
  for (const [a,b] of board.edges) {
    if (!map.has(a) || !map.has(b)) continue;
    map.get(a).push(b);
    map.get(b).push(a);
  }
  return map;
}
function isOccupied(room, nodeId) {
  for (const c of COLORS) {
    for (const pos of room.pieces[c]) {
      if (pos === nodeId) return true;
    }
  }
  return false;
}
function destinationsExact(room, fromNode, steps) {
  const board = room.board;
  const neigh = neighbors(board);
  const barricadeSet = new Set(board.barricades);
  let frontier = new Set([fromNode]);
  for (let s = 1; s <= steps; s++) {
    const next = new Set();
    for (const u of frontier) {
      for (const v of (neigh.get(u) || [])) {
        if (!neigh.has(v)) continue;
        if (isOccupied(room, v)) continue;
        if (barricadeSet.has(v) && s !== steps) continue;
        next.add(v);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return [...frontier];
}
function canMovePiece(room, color, pieceIndex, toNode) {
  const steps = room.turn.roll;
  if (room.turn.step !== "MOVE" || typeof steps !== "number") return { ok:false, reason:"not_in_move_phase" };
  const pos = room.pieces[color][pieceIndex];
  const start = room.board.startNodes?.[color];
  if (!start) return { ok:false, reason:"missing_startNode" };
  if (pos === null) {
    if (toNode !== start) return { ok:false, reason:"home_can_only_enter_start" };
    if (isOccupied(room, toNode)) return { ok:false, reason:"start_occupied" };
    return { ok:true };
  }
  const dests = destinationsExact(room, pos, steps);
  if (!dests.includes(toNode)) return { ok:false, reason:"not_reachable_in_exact_steps" };
  return { ok:true };
}
function applyMove(room, color, pieceIndex, toNode) {
  const board = room.board;
  const barricadeSet = new Set(board.barricades);
  room.pieces[color][pieceIndex] = toNode;

  if (barricadeSet.has(toNode)) {
    board.barricades = board.barricades.filter(x => x !== toNode);
    room.pendingBarricadeFrom = toNode;
    room.turn.step = "BARRICADE_PLACE";
    room.turn.lastAction = { type:"PICKUP_BARRICADE", color, pieceIndex, at: toNode };
    return;
  }

  room.turn.lastAction = { type:"MOVE", color, pieceIndex, to: toNode, roll: room.turn.roll };
  room.turn.lastRoll = room.turn.roll;
  room.turn.roll = null;
  room.turn.step = "ROLL";
  room.turn.activeColor = nextColor(room, room.turn.activeColor);
}
function canPlaceBarricade(room, nodeId) {
  if (room.turn.step !== "BARRICADE_PLACE") return { ok:false, reason:"not_in_barricade_place" };
  const board = room.board;
  const node = board.nodes.find(n => n.id === nodeId);
  if (!node) return { ok:false, reason:"node_missing" };
  if (node.kind !== "board") return { ok:false, reason:"not_on_board_kind" };
  if (isOccupied(room, nodeId)) return { ok:false, reason:"occupied" };
  if (board.forbiddenBarricadeNodes?.includes(nodeId)) return { ok:false, reason:"forbidden" };
  if (board.barricades.includes(nodeId)) return { ok:false, reason:"already_has_barricade" };
  return { ok:true };
}
function applyPlaceBarricade(room, color, nodeId) {
  room.board.barricades.push(nodeId);
  room.turn.lastAction = { type:"PLACE_BARRICADE", color, at: nodeId, from: room.pendingBarricadeFrom };
  room.pendingBarricadeFrom = null;
  room.turn.lastRoll = room.turn.roll ?? room.turn.lastRoll;
  room.turn.roll = null;
  room.turn.step = "ROLL";
  room.turn.activeColor = nextColor(room, room.turn.activeColor);
}

const rooms = new Map();
function ensureRoom(code, hostSocketId) {
  let r = rooms.get(code);
  if (!r) {
    r = makeInitialRoom(code, hostSocketId);
    rooms.set(code, r);
  }
  return r;
}

wss.on("connection", (ws) => {
  ws.__socketId = Math.random().toString(36).slice(2);
  ws.__roomCode = null;

  send(ws, { t:"HELLO", socketId: ws.__socketId, ts: now() });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== "string") return;

    if (msg.t === "HOST_ROOM") {
      const code = rid();
      const room = ensureRoom(code, ws.__socketId);
      room.hostSocketId = ws.__socketId;
      ws.__roomCode = code;
      room.spectators[ws.__socketId] = true;
      send(ws, { t:"ROOM_CODE", code });
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    if (msg.t === "JOIN_ROOM") {
      const code = (msg.code || "").toString().trim().toUpperCase();
      if (!code) return send(ws, { t:"ERR", message:"Missing room code" });
      const room = ensureRoom(code, ws.__socketId);
      ws.__roomCode = code;
      if (!room.hostSocketId) room.hostSocketId = ws.__socketId;
      room.spectators[ws.__socketId] = true;
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    const code = ws.__roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (msg.t === "CLAIM_COLOR") {
      const color = (msg.color || "").toString();
      const playerId = (msg.playerId || "").toString();
      if (!COLORS.includes(color) || !playerId) return;

      const existing = room.players[color];
      if (existing && existing.playerId !== playerId) {
        return send(ws, { t:"ERR", message:"Color already taken" });
      }

      for (const c of COLORS) {
        const p = room.players[c];
        if (p && p.playerId === playerId && c !== color) {
          if (room.phase !== "LOBBY") return send(ws, { t:"ERR", message:"Cannot change color after start" });
          delete room.players[c];
        }
      }

      room.players[color] = { playerId, socketId: ws.__socketId, connected: true };
      delete room.spectators[ws.__socketId];
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    if (msg.t === "START_GAME") {
      if (!isHost(ws, room)) return;
      if (room.phase !== "LOBBY") return;
      const n = countTakenPlayers(room);
      if (n < 2) return send(ws, { t:"ERR", message:"Need at least 2 players" });
      room.phase = "GAME";
      room.started = true;
      room.turn.activeColor = nextColor(room, null);
      room.turn.step = "ROLL";
      room.turn.roll = null;
      room.turn.lastAction = { type:"START", by:"host" };
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    if (msg.t === "RESET_ROOM") {
      if (!isHost(ws, room)) return;
      const keepPlayers = !!msg.keepPlayers;
      const oldPlayers = room.players;
      const newRoom = makeInitialRoom(room.code, room.hostSocketId);
      if (keepPlayers) newRoom.players = oldPlayers;
      rooms.set(room.code, newRoom);
      broadcast(newRoom, { t:"STATE", state: roomSnapshot(newRoom) });
      return;
    }

    if (msg.t === "BOARD_SET") {
      if (!isHost(ws, room)) return;
      if (room.phase !== "LOBBY") return;
      const board = msg.board;
      if (!board || !Array.isArray(board.nodes) || !Array.isArray(board.edges)) return;

      room.board.nodes = board.nodes.map(n => ({
        id: String(n.id),
        x: Number(n.x),
        y: Number(n.y),
        kind: n.kind || "board",
        flags: n.flags || {}
      })).filter(n => n.id && Number.isFinite(n.x) && Number.isFinite(n.y));

      room.board.edges = board.edges.map(e => [String(e[0]), String(e[1])]).filter(e => e[0] && e[1] && e[0] !== e[1]);
      room.board.barricades = Array.isArray(board.barricades) ? board.barricades.map(String) : [];
      room.board.startNodes = board.startNodes || room.board.startNodes;
      room.board.forbiddenBarricadeNodes = board.forbiddenBarricadeNodes || room.board.forbiddenBarricadeNodes;
      room.board.goalNode = board.goalNode || room.board.goalNode;

      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    if (msg.t === "REQUEST_ROLL") {
      if (room.phase !== "GAME") return;
      if (room.turn.step !== "ROLL") return;
      if (!isMyTurn(ws, room)) return;

      const roll = 1 + Math.floor(Math.random() * 6);
      room.turn.roll = roll;
      room.turn.step = "MOVE";
      room.turn.lastAction = { type:"ROLL", color: room.turn.activeColor, roll };
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    if (msg.t === "MOVE") {
      if (room.phase !== "GAME") return;
      if (!isMyTurn(ws, room)) return;
      if (room.turn.step !== "MOVE") return;

      const color = room.turn.activeColor;
      const pieceIndex = Number(msg.pieceIndex);
      const toNode = String(msg.toNode);
      if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex > 3) return;

      const check = canMovePiece(room, color, pieceIndex, toNode);
      if (!check.ok) return send(ws, { t:"ERR", message:`Move blocked: ${check.reason}` });

      applyMove(room, color, pieceIndex, toNode);
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    if (msg.t === "PLACE_BARRICADE") {
      if (room.phase !== "GAME") return;
      if (!isMyTurn(ws, room)) return;
      if (room.turn.step !== "BARRICADE_PLACE") return;

      const nodeId = String(msg.nodeId);
      const color = room.turn.activeColor;
      const check = canPlaceBarricade(room, nodeId);
      if (!check.ok) return send(ws, { t:"ERR", message:`Cannot place barricade: ${check.reason}` });

      applyPlaceBarricade(room, color, nodeId);
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }
  });

  ws.on("close", () => {
    const code = ws.__roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    for (const c of COLORS) {
      const p = room.players[c];
      if (p && p.socketId === ws.__socketId) {
        p.connected = false;
        p.socketId = null;
      }
    }
    delete room.spectators[ws.__socketId];
    broadcast(room, { t:"STATE", state: roomSnapshot(room) });
  });
});

server.listen(PORT, () => console.log("barikade-server listening on " + PORT));
