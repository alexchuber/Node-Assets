// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";

const internalNamingPlugin = {
    rules: {
        "underscore-prefix": {
            meta: {
                type: "problem",
                schema: [],
                messages: {
                    missingPrefix: 'API "{{name}}" is marked @internal and must start with an underscore.',
                },
            },
            create(context) {
                const sourceCode = context.sourceCode;

                return {
                    "Program:exit"() {
                        for (const comment of sourceCode.getAllComments()) {
                            if (!/@internal\b/u.test(comment.value)) {
                                continue;
                            }

                            const token = sourceCode.getTokenAfter(comment);
                            let node = token === null ? null : sourceCode.getNodeByRangeIndex(token.range[0]);
                            if (node?.type === "ExportNamedDeclaration") {
                                node = node.declaration;
                            }

                            while (node !== null) {
                                if (node.type === "MethodDefinition" && node.kind === "constructor") {
                                    break;
                                }

                                const nameNode =
                                    "id" in node && node.id?.type === "Identifier"
                                        ? node.id
                                        : "key" in node && node.key?.type === "Identifier"
                                          ? node.key
                                          : node.type === "TSParameterProperty" && node.parameter.type === "Identifier"
                                            ? node.parameter
                                            : null;
                                if (nameNode !== null) {
                                    if (!nameNode.name.startsWith("_")) {
                                        context.report({ node: nameNode, messageId: "missingPrefix", data: { name: nameNode.name } });
                                    }
                                    break;
                                }

                                node = node.parent;
                            }
                        }
                    },
                };
            },
        },
    },
};

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "test-results/**", "docs/**", "**/*.md"],
    },

    js.configs.recommended,
    eslintConfigPrettier,

    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parser: tseslint.parser,
            parserOptions: {
                sourceType: "module",
                ecmaVersion: 2022,
            },
        },
        plugins: {
            internalNaming: internalNamingPlugin,
            prettier: eslintPluginPrettier,
        },
        rules: {
            "internalNaming/underscore-prefix": "error",
            "prettier/prettier": "error",
        },
    },

    {
        files: ["**/*.ts"],
        extends: [tseslint.configs.recommended],
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        },
    }
);
