/**
 * @typedef {import('mdast').AlignType} AlignType
 * @typedef {import('mdast').Table} Table
 * @typedef {import('mdast').TableRow} TableRow
 * @typedef {import('mdast').TableCell} TableCell
 * @typedef {import('mdast').InlineCode} InlineCode
 * @typedef {import('markdown-table').MarkdownTableOptions} MarkdownTableOptions
 * @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
 * @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
 * @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
 * @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
 * @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
 * @typedef {import('mdast-util-to-markdown').Context} ToMarkdownContext
 * @typedef {import('mdast-util-to-markdown').SafeOptions} SafeOptions
 *
 * @typedef Options
 * @property {boolean} [tableCellPadding=true]
 * @property {boolean} [tablePipeAlign=true]
 * @property {MarkdownTableOptions['stringLength']} [stringLength]
 */

import {containerPhrasing} from 'mdast-util-to-markdown/lib/util/container-phrasing.js'
import {inlineCode} from 'mdast-util-to-markdown/lib/handle/inline-code.js'
import {markdownTable} from 'markdown-table'

/** @type {FromMarkdownExtension} */
export const gfmTableFromMarkdown = {
  enter: {
    table: enterTable,
    tableData: enterCell,
    tableHeader: enterCell,
    tableRow: enterRow
  },
  exit: {
    codeText: exitCodeText,
    table: exitTable,
    tableData: exit,
    tableHeader: exit,
    tableRow: exit
  }
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterTable(token) {
  /** @type {Array<'left'|'right'|'center'|'none'>} */
  // @ts-expect-error: `align` is custom.
  const align = token._align
  this.enter(
    {
      type: 'table',
      align: align.map((d) => (d === 'none' ? null : d)),
      children: []
    },
    token
  )
  // @ts-expect-error: to do: map.
  this.setData('inTable', true)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitTable(token) {
  this.exit(token)
  // @ts-expect-error: to do: map.
  this.setData('inTable')
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterRow(token) {
  this.enter({type: 'tableRow', children: []}, token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exit(token) {
  this.exit(token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterCell(token) {
  this.enter({type: 'tableCell', children: []}, token)
}

// Overwrite the default code text data handler to unescape escaped pipes when
// they are in tables.
/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitCodeText(token) {
  let value = this.resume()

  // @ts-expect-error: to do: map.
  if (this.getData('inTable')) {
    value = value.replace(/\\([\\|])/g, replace)
  }

  const node = /** @type {InlineCode} */ (this.stack[this.stack.length - 1])
  node.value = value
  this.exit(token)
}

/**
 * @param {string} $0
 * @param {string} $1
 * @returns {string}
 */
function replace($0, $1) {
  // Pipes work, backslashes don’t (but can’t escape pipes).
  return $1 === '|' ? $1 : $0
}

/**
 * @param {Options} [options]
 * @returns {ToMarkdownExtension}
 */
export function gfmTableToMarkdown(options) {
  const settings = options || {}
  const padding = settings.tableCellPadding
  const alignDelimiters = settings.tablePipeAlign
  const stringLength = settings.stringLength
  const around = padding ? ' ' : '|'

  return {
    unsafe: [
      // @ts-expect-error: to do: map.
      {character: '\r', inConstruct: 'tableCell'},
      // @ts-expect-error: to do: map.
      {character: '\n', inConstruct: 'tableCell'},
      // A pipe, when followed by a tab or space (padding), or a dash or colon
      // (unpadded delimiter row), could result in a table.
      {atBreak: true, character: '|', after: '[\t :-]'},
      // A pipe in a cell must be encoded.
      // @ts-expect-error: to do: map.
      {character: '|', inConstruct: 'tableCell'},
      // A colon must be followed by a dash, in which case it could start a
      // delimiter row.
      {atBreak: true, character: ':', after: '-'},
      // A delimiter row can also start with a dash, when followed by more
      // dashes, a colon, or a pipe.
      // This is a stricter version than the built in check for lists, thematic
      // breaks, and setex heading underlines though:
      // <https://github.com/syntax-tree/mdast-util-to-markdown/blob/51a2038/lib/unsafe.js#L57>
      {atBreak: true, character: '-', after: '[:|-]'}
    ],
    handlers: {
      table: handleTable,
      tableRow: handleTableRow,
      tableCell: handleTableCell,
      inlineCode: inlineCodeWithTable
    }
  }

  /**
   * @type {ToMarkdownHandle}
   * @param {Table} node
   */
  function handleTable(node, _, context, safeOptions) {
    return serializeData(
      handleTableAsData(node, context, safeOptions),
      // @ts-expect-error: fixed in `markdown-table@3.0.1`.
      node.align
    )
  }

  /**
   * This function isn’t really used normally, because we handle rows at the
   * table level.
   * But, if someone passes in a table row, this ensures we make somewhat sense.
   *
   * @type {ToMarkdownHandle}
   * @param {TableRow} node
   */
  function handleTableRow(node, _, context, safeOptions) {
    const row = handleTableRowAsData(node, context, safeOptions)
    // `markdown-table` will always add an align row
    const value = serializeData([row])
    return value.slice(0, value.indexOf('\n'))
  }

  /**
   * @type {ToMarkdownHandle}
   * @param {TableCell} node
   */
  function handleTableCell(node, _, context, safeOptions) {
    // @ts-expect-error: to do: map.
    const exit = context.enter('tableCell')
    const subexit = context.enter('phrasing')
    const value = containerPhrasing(node, context, {
      ...safeOptions,
      before: around,
      after: around
    })
    subexit()
    exit()
    return value
  }

  /**
   * @param {Array<Array<string>>} matrix
   * @param {Array<string>} [align]
   */
  function serializeData(matrix, align) {
    return markdownTable(matrix, {
      align,
      alignDelimiters,
      padding,
      stringLength
    })
  }

  /**
   * @param {Table} node
   * @param {ToMarkdownContext} context
   * @param {SafeOptions} safeOptions
   */
  function handleTableAsData(node, context, safeOptions) {
    const children = node.children
    let index = -1
    /** @type {Array<Array<string>>} */
    const result = []
    // @ts-expect-error: to do: map.
    const subexit = context.enter('table')

    while (++index < children.length) {
      result[index] = handleTableRowAsData(
        children[index],
        context,
        safeOptions
      )
    }

    subexit()

    return result
  }

  /**
   * @param {TableRow} node
   * @param {ToMarkdownContext} context
   * @param {SafeOptions} safeOptions
   */
  function handleTableRowAsData(node, context, safeOptions) {
    const children = node.children
    let index = -1
    /** @type {Array<string>} */
    const result = []
    // @ts-expect-error: to do: map.
    const subexit = context.enter('tableRow')

    while (++index < children.length) {
      // Note: the positional info as used here is incorrect.
      // Making it correct would be impossible due to aligning cells?
      // And it would need copy/pasting `markdown-table` into this project.
      result[index] = handleTableCell(
        children[index],
        node,
        context,
        safeOptions
      )
    }

    subexit()

    return result
  }

  /**
   * @type {ToMarkdownHandle}
   * @param {InlineCode} node
   */
  function inlineCodeWithTable(node, parent, context) {
    let value = inlineCode(node, parent, context)

    // @ts-expect-error: to do: map.
    if (context.stack.includes('tableCell')) {
      value = value.replace(/\|/g, '\\$&')
    }

    return value
  }
}