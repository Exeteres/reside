import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isRecord } from "@reside/utils"

type ExportMap = Record<string, string>

type PackageJsonData = {
	exports?: ExportMap
	[key: string]: unknown
}

const packageRootPath = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRootPath = resolve(packageRootPath, "..", "..")
const protocolsPath = resolve(packageRootPath, "protocols")
const generatedPath = resolve(packageRootPath, "src", "_generated")
const packageJsonPath = resolve(packageRootPath, "package.json")
const localBinPath = resolve(packageRootPath, "node_modules", ".bin")
const grpcToolsBinaryPath = resolve(localBinPath, "grpc_tools_node_protoc")
const tsProtoPluginBinaryPath = resolve(localBinPath, "protoc-gen-ts_proto")

await generate()

async function generate(): Promise<void> {
	await ensureGenerationBinaries()

	const protoFiles = await collectFilesWithExtension(protocolsPath, ".proto")
	if (protoFiles.length === 0) {
		throw new Error(`No .proto specs found in "${protocolsPath}"`)
	}

	await rm(generatedPath, { recursive: true, force: true })
	await mkdir(generatedPath, { recursive: true })

	const generateCommand = [
		grpcToolsBinaryPath,
		`--plugin=protoc-gen-ts_proto=${tsProtoPluginBinaryPath}`,
		`--ts_proto_out=${generatedPath}`,
		"--ts_proto_opt=esModuleInterop=true,outputServices=nice-grpc,outputServices=generic-definitions,forceLong=string,useExactTypes=false,oneof=unions-value",
    "--ts_proto_opt=removeEnumPrefix=true",
		`-I${protocolsPath}`,
		`-I${resolve(packageRootPath, "node_modules")}`,
		`-I${resolve(packageRootPath, "node_modules", "google-proto-files")}`,
		...protoFiles,
	]

	await runCommand(generateCommand, packageRootPath)

	const generatedTypeScriptFiles = await collectFilesWithExtension(generatedPath, ".ts")
	if (generatedTypeScriptFiles.length === 0) {
		throw new Error(`Generation produced no TypeScript files in "${generatedPath}"`)
	}

	await syncPackageExports(generatedTypeScriptFiles)
}

async function ensureGenerationBinaries(): Promise<void> {
	const hasGrpcTools = await pathExists(grpcToolsBinaryPath)
	if (!hasGrpcTools) {
		throw new Error(
			`grpc_tools_node_protoc not found at "${grpcToolsBinaryPath}". Install dependencies in packages/api first.`,
		)
	}

	const hasTsProtoPlugin = await pathExists(tsProtoPluginBinaryPath)
	if (!hasTsProtoPlugin) {
		throw new Error(
			`protoc-gen-ts_proto not found at "${tsProtoPluginBinaryPath}". Install dependencies in packages/api first.`,
		)
	}
}

async function syncPackageExports(generatedTypeScriptFiles: string[]): Promise<void> {
	const packageJsonText = await readFile(packageJsonPath, "utf-8")
	const parsedPackageJson = parsePackageJson(packageJsonText)

	const generatedExports = buildGeneratedExports(generatedTypeScriptFiles)
	const existingExports = parsedPackageJson.exports ?? {}

	const preservedExports: ExportMap = {}
	for (const [exportPath, targetPath] of Object.entries(existingExports)) {
		if (!targetPath.startsWith("./src/_generated/")) {
			preservedExports[exportPath] = targetPath
		}
	}

	parsedPackageJson.exports = {
		...preservedExports,
		...generatedExports,
	}

	const nextPackageJsonText = `${JSON.stringify(parsedPackageJson, null, 2)}\n`
	await writeFile(packageJsonPath, nextPackageJsonText)
}

function parsePackageJson(packageJsonText: string): PackageJsonData {
	const parsedValue = JSON.parse(packageJsonText)
	if (!isRecord(parsedValue)) {
		throw new Error(`Invalid package.json at "${packageJsonPath}": expected an object`)
	}

	const packageJsonData: PackageJsonData = {}
	for (const [key, value] of Object.entries(parsedValue)) {
		packageJsonData[key] = value
	}

	const exportsValue = packageJsonData.exports
	if (exportsValue === undefined) {
		return packageJsonData
	}

	if (!isStringRecord(exportsValue)) {
		throw new Error(
			`Invalid package.json exports at "${packageJsonPath}": expected an object of string values`,
		)
	}

	packageJsonData.exports = exportsValue
	return packageJsonData
}

function buildGeneratedExports(generatedTypeScriptFiles: string[]): ExportMap {
	const generatedExports: ExportMap = {}

	const sortedFiles = [...generatedTypeScriptFiles].sort((left, right) =>
		left.localeCompare(right),
	)

	for (const generatedFilePath of sortedFiles) {
		const relativePath = relative(generatedPath, generatedFilePath).replaceAll("\\", "/")
		const exportName = relativePath.endsWith(".ts")
			? relativePath.slice(0, relativePath.length - 3)
			: relativePath

		generatedExports[`./${exportName}`] = `./src/_generated/${relativePath}`
	}

	return generatedExports
}

async function collectFilesWithExtension(
	directoryPath: string,
	extension: string,
): Promise<string[]> {
	const entries = await readdir(directoryPath, { withFileTypes: true })

	const files: string[] = []

	for (const entry of entries) {
		const fullPath = resolve(directoryPath, entry.name)

		if (entry.isDirectory()) {
			const nestedFiles = await collectFilesWithExtension(fullPath, extension)
			files.push(...nestedFiles)
			continue
		}

		if (entry.isFile() && entry.name.endsWith(extension)) {
			files.push(fullPath)
		}
	}

	return files
}

async function runCommand(command: string[], cwd: string): Promise<void> {
	const processHandle = Bun.spawn(command, {
		cwd,
		env: process.env,
		stdout: "inherit",
		stderr: "inherit",
	})

	const exitCode = await processHandle.exited
	if (exitCode !== 0) {
		throw new Error(`Command "${command.join(" ")}" failed with exit code ${exitCode}`)
	}
}

async function pathExists(pathToCheck: string): Promise<boolean> {
	try {
		await access(pathToCheck)
		return true
	} catch {
		return false
	}
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!isRecord(value)) {
		return false
	}

	for (const itemValue of Object.values(value)) {
		if (typeof itemValue !== "string") {
			return false
		}
	}

	return true
}
