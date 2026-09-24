#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
	.name("lca")
	.description("lingchen-art CLI")
	.version("1.0.0");

program
	.command("hello")
	.description("Print a greeting")
	.argument("[name]", "who to greet", "world")
	.action((name: string) => {
		console.log(`hello, ${name}`);
	});

program.parse();
