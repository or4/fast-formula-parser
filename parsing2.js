const lexer = require('./lexing');
const chevrotain = require("chevrotain");
const tokenVocabulary = lexer.tokenVocabulary;

const {
    parseCellAddress, parseColRange, parseRowRange,
    toArray, toNumber, toString, toBoolean, toError,
    applyPrefix, applyPostfix, applyInfix, applyIntersect, applyUnion
} = require('./utils/utils');
const {
    // IntersectOp,
    WhiteSpace,
    String,
    SingleQuotedString,
    SheetQuoted,
    ExcelRefFunction,
    ExcelConditionalRefFunction,
    Function,
    FormulaError,
    RefError,
    Cell,
    RangeColumn,
    RangeRow,
    Sheet,
    ReservedName,
    Name,
    Number,
    Boolean,
    // Array,

    At,
    Comma,
    Colon,
    Semicolon,
    OpenParen,
    CloseParen,
    OpenSquareParen,
    CloseSquareParen,
    // ExclamationMark,
    OpenCurlyParen,
    CloseCurlyParen,
    QuoteS,
    MulOp,
    PlusOp,
    DivOp,
    MinOp,
    ConcateOp,
    ExOp,
    // IntersectOp,
    PercentOp,
    NeqOp,
    GteOp,
    LteOp,
    GtOp,
    EqOp,
    LtOp
} = tokenVocabulary;

class Parser extends chevrotain.Parser {
    constructor(context) {
        super(tokenVocabulary, {
            outputCst: false,
            maxLookahead: 1,
            ignoredIssues: {
                // referenceWithIntersect: {OR9: true},
                // formula: {OR9: true},
                paren: {OR9: true}
            }
        });
        const {getCell, getColumnRange, getRowRange, getRange, getVariable, callFunction} = context;
        const $ = this;

        // Adopted from https://github.com/spreadsheetlab/XLParser/blob/master/src/XLParser/ExcelFormulaGrammar.cs

        $.RULE('formulaWithCompareOp', () => {
            let value = $.SUBRULE($.formulaWithConcatOp);
            $.MANY(() => {
                const infix = $.SUBRULE($.compareOp);
                const value2 = $.SUBRULE2($.formulaWithConcatOp);
                value = applyInfix(value, infix, value2);
            });
            return value;
        });

        $.RULE('compareOp', () => $.OR([
            {ALT: () => $.CONSUME(GtOp).image},
            {ALT: () => $.CONSUME(EqOp).image},
            {ALT: () => $.CONSUME(LtOp).image},
            {ALT: () => $.CONSUME(NeqOp).image},
            {ALT: () => $.CONSUME(GteOp).image},
            {ALT: () => $.CONSUME(LteOp).image},
        ]));


        $.RULE('formulaWithConcatOp', () => {
            let value = $.SUBRULE($.formulaWithBinaryOp);
            $.MANY(() => {
                const infix = $.CONSUME(ConcateOp).image;
                const formula2 = $.SUBRULE2($.formulaWithBinaryOp);
                value = applyInfix(value, infix, formula2);
            });
            return value;
        });


        $.RULE('formulaWithBinaryOp', () => {
            let value = $.SUBRULE($.formulaWithMulDivOp);
            $.MANY(() => {
                const infix = $.SUBRULE($.plusMinusOp);
                const formula2 = $.SUBRULE2($.formulaWithMulDivOp);
                value = applyInfix(value, infix, formula2);
            });
            return value;
        });

        $.RULE('plusMinusOp', () => $.OR([
            {ALT: () => $.CONSUME(PlusOp).image},
            {ALT: () => $.CONSUME(MinOp).image}
        ]));

        $.RULE('formulaWithMulDivOp', () => {
            let value = $.SUBRULE($.formulaWithExOp);
            $.MANY(() => {
                const infix = $.SUBRULE($.mulDivOp);
                const formula2 = $.SUBRULE2($.formulaWithExOp);
                value = applyInfix(value, infix, formula2);
            });
            return value;
        });

        $.RULE('mulDivOp', () => $.OR([
            {ALT: () => $.CONSUME(MulOp).image},
            {ALT: () => $.CONSUME(DivOp).image}
        ]));

        $.RULE('formulaWithExOp', () => {
            let value = $.SUBRULE($.formulaWithPercentOp);
            $.MANY(() => {
                const infix = $.CONSUME(ExOp).image;
                const formula2 = $.SUBRULE2($.formulaWithPercentOp);
                value = applyInfix(value, infix, formula2);
            });
            return value;
        });

        $.RULE('formulaWithPercentOp', () => {
            let value = $.SUBRULE($.formulaWithUnaryOp);
            $.OPTION(() => {
                const postfix = $.CONSUME(PercentOp).image;
                value = applyPostfix(value, postfix);
            });
            return value;
        });

        $.RULE('formulaWithUnaryOp', () => {
            // support ++---3 => -3
            const prefixes = [];
            $.MANY(() => {
                prefixes.push($.SUBRULE($.plusMinusOp));
            });
            const formula = $.SUBRULE($.formulaWithIntersect);
            if (prefixes.length > 0) return applyPrefix(prefixes, formula);
            return formula;
        });

        $.RULE('formulaWithIntersect', () => $.OR9([
            {
                // e.g.  'A1 A2 A3'
                ALT: () => {
                    let ref1 = $.SUBRULE($.formulaWithRange);
                    const refs = [ref1];
                    // console.log('check intersect')
                    $.MANY({
                        GATE: () => {
                            // see https://github.com/SAP/chevrotain/blob/master/examples/grammars/css/css.js#L436-L441
                            const prevToken = $.LA(0);
                            const nextToken = $.LA(1);
                            //  This is the only place where the grammar is whitespace sensitive.
                            return nextToken.startOffset > prevToken.endOffset;
                        },
                        DEF: () => {
                            refs.push($.SUBRULE3($.formulaWithRange));
                        }
                    });
                    if (refs.length > 1) {
                        return applyIntersect(refs);
                    }
                    return ref1;
                }
            }
        ]));

        $.RULE('formulaWithRange', () => {
            // e.g. 'A1:C3' or 'A1:A3:C4', can be any number of references, at lease 2
            const ref1 = $.SUBRULE($.formula);
            const refs = [ref1];
            $.MANY(() => {
                $.CONSUME(Colon);
                refs.push($.SUBRULE2($.formula));
            });
            return getRange(refs);
        });

        $.RULE('formula', () => $.OR9([
            {ALT: () => $.SUBRULE($.reservedName)},
            {ALT: () => $.SUBRULE($.referenceWithoutInfix)},
            {ALT: () => $.SUBRULE($.paren)},
            {ALT: () => $.SUBRULE($.constant)},
            {ALT: () => $.SUBRULE($.functionCall)},
            {ALT: () => $.SUBRULE($.constantArray)},
        ]));

        $.RULE('paren', () => $.OR9([
            {
                GATE: $.BACKTRACK($.refUnion),
                ALT: () => {
                    // console.log('backtracked')
                    return $.SUBRULE($.refUnion)
                }
            },
            {
                ALT: () => {
                    return $.SUBRULE($.formulaParen)
                }
            }
        ]));

        $.RULE('refUnion', () => {
            $.CONSUME(OpenParen);
            const result = $.SUBRULE($.union);
            $.CONSUME(CloseParen);
            return result;
        });

        $.RULE('union', () => {
            // console.log('try union')
            const args = [];
            args.push($.SUBRULE($.formulaWithIntersect));
            $.MANY(() => {
                $.CONSUME(Comma);
                args.push($.SUBRULE2($.formulaWithIntersect));
            });

            return applyUnion(...args);
        });

        $.RULE('formulaParen', () => {
            // console.log('formula paren');
            $.CONSUME(OpenParen);
            const value = $.SUBRULE($.formulaWithCompareOp);
            $.CONSUME(CloseParen);
            return value;
        });

        $.RULE('constantArray', () => {
            // console.log('constantArray');
            const arr = [[]];
            let currentRow = 0;
            $.CONSUME(OpenCurlyParen);

            // array must contain at least one item
            arr[currentRow].push($.SUBRULE($.constantForArray));
            $.MANY(() => {
                const sep = $.OR([
                    {ALT: () => $.CONSUME(Comma).image},
                    {ALT: () => $.CONSUME(Semicolon).image}
                ]);
                const constant = $.SUBRULE2($.constantForArray);
                if (sep === ',') {
                    arr[currentRow].push(constant)
                } else {
                    currentRow++;
                    arr[currentRow] = [];
                    arr[currentRow].push(constant)
                }
            });

            $.CONSUME(CloseCurlyParen);

            return toArray(arr);
        });

        /**
         * Used in array
         */
        $.RULE('constantForArray', () => $.OR([
            {
                ALT: () => {
                    const prefix = $.OPTION(() => $.SUBRULE($.plusMinusOp));
                    const number = toNumber($.CONSUME(Number).image);
                    if (prefix)
                        return applyPrefix([prefix], number);
                    return number;
                }
            }, {
                ALT: () => {
                    return toString($.CONSUME(String).image);
                }
            }, {
                ALT: () => {
                    return toBoolean($.CONSUME(Boolean).image);
                }
            }, {
                ALT: () => {
                    return toError($.CONSUME(FormulaError).image);
                }
            }, {
                ALT: () => {
                    return toError($.CONSUME(RefError).image);
                }
            },
        ]));

        $.RULE('reservedName', () => {
            const name = $.CONSUME(ReservedName).image;
            return getVariable(name);
        });

        $.RULE('constant', () => $.OR([
            {
                ALT: () => {
                    return toNumber($.CONSUME(Number).image);
                }
            }, {
                ALT: () => {
                    return toString($.CONSUME(String).image);
                }
            }, {
                ALT: () => {
                    return toBoolean($.CONSUME(Boolean).image);
                }
            }, {
                ALT: () => {
                    return toError($.CONSUME(FormulaError).image);
                }
            },
        ]));

        $.RULE('functionCall', () => $.OR([
            {
                ALT: () => {
                    const functionName = $.CONSUME(Function).image.slice(0, -1);
                    // console.log('functionName', functionName);
                    const args = $.OPTION(() => $.SUBRULE($.arguments));
                    $.CONSUME(CloseParen);
                    return callFunction(functionName, args);
                }
            }
        ]));

        $.RULE('arguments', () => {
            // console.log('try arguments')

            // allows ',' in the front
            $.MANY2(() => {
                $.CONSUME2(Comma);
            });
            const args = [];
            // allows empty arguments
            $.OPTION(() => {
                args.push($.SUBRULE($.formulaWithCompareOp));
                $.MANY(() => {
                    $.CONSUME1(Comma);
                    $.OPTION3(() => args.push($.SUBRULE2($.formulaWithCompareOp)));
                });
            });
            return args;
        });

        $.RULE('postfixOp', () => $.CONSUME(PercentOp).image);


        $.RULE('referenceWithoutInfix', () => $.OR([

            {ALT: () => getCell($.SUBRULE($.referenceItem))},
            {ALT: () => $.SUBRULE($.referenceFunctionCall)},

            {
                // sheet name prefix
                ALT: () => {
                    // console.log('try sheetName');
                    const sheetName = $.SUBRULE($.prefixName);
                    // console.log('sheetName', sheetName);
                    const referenceItem = $.SUBRULE2($.formulaWithRange);
                    referenceItem.sheet = sheetName;
                    return getCell(referenceItem);
                }
            },

            // {ALT: () => $.SUBRULE('dynamicDataExchange')},
        ]));

        $.RULE('referenceFunctionCall', () => $.OR([

            {
                ALT: () => {
                    const refFunctionName = $.SUBRULE($.refFunctionName);
                    // console.log('refFunctionName', refFunctionName);
                    const args = $.SUBRULE($.arguments);
                    $.CONSUME2(CloseParen);
                    return callFunction(refFunctionName, args);
                }
            }
        ]));

        $.RULE('refFunctionName', () => $.OR([
            {ALT: () => $.CONSUME(ExcelRefFunction).image.slice(0, -1)},
            {ALT: () => $.CONSUME(ExcelConditionalRefFunction).image.slice(0, -1)}
        ]));

        $.RULE('referenceItem', () => $.OR([
            {ALT: () => $.SUBRULE($.cell)},
            {ALT: () => $.SUBRULE($.namedRange)},
            {ALT: () => $.SUBRULE($.vRange)},
            {ALT: () => $.SUBRULE($.hRange)},
            {ALT: () => $.SUBRULE($.refError)},
            // {ALT: () => $.SUBRULE($.udfFunctionCall)},
            // {ALT: () => $.SUBRULE($.structuredReference)},
        ]));

        $.RULE('vRange', () => {
            return getColumnRange(parseColRange($.CONSUME(RangeColumn).image));
        });

        $.RULE('hRange', () => {
            return getRowRange(parseRowRange($.CONSUME(RangeRow).image));
        });

        $.RULE('cell', () => {
            return parseCellAddress($.CONSUME(Cell).image);
        });

        $.RULE('namedRange', () => {
            return getVariable($.CONSUME(Name).image);
        });

        $.RULE('prefixName', () => $.OR([
            {ALT: () => $.CONSUME(Sheet).image.slice(0, -1)},
            {ALT: () => $.CONSUME(SheetQuoted).image.slice(1, -2)},
        ]));

        $.RULE('refError', () => $.CONSUME(RefError).image);

        this.performSelfAnalysis();
    }
}

module.exports = {
    allTokens: Object.values(tokenVocabulary),
    Parser: Parser,
};
