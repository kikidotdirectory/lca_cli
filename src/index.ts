#!/usr/bin/env node
import { Command } from "commander";
import { authenticateClient } from "./auth.js";
import { readSheets, sheetName } from "./sheets.js";

const program = new Command();

program
	.name("lca")
	.description("lingchen-art CLI")
	.version("1.0.0");

program
	.command("login")
	.action(authenticateClient);

program
	.command("sheetselect")
	.action(sheetName);

program
	.command("buildsheets")
	.action(readSheets);

program.parse();
