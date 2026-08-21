#!/usr/bin/env python3
import sys
import json
import pandas as pd

def extract_nested_value(obj, path):
    """按点分隔路径从嵌套字典中取值，若路径不存在返回None"""
    parts = path.split('.')
    value = obj
    for p in parts:
        if isinstance(value, dict):
            value = value.get(p)
            if value is None:
                break
        else:
            return None
    return value

def main():
    # 从标准输入读取JSON
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"JSON解析错误: {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(data, list):
        print("输入必须是JSON数组", file=sys.stderr)
        sys.exit(1)

    if not data:
        print("输入数组为空，生成空Excel", file=sys.stderr)
        sys.exit(0)

    # 提取日期：从每个元素的 tuanjieHub.date 获取
    dates = []
    for item in data:
        # 优先从 tuanjieHub 取，若缺失则尝试 newUser
        date_val = extract_nested_value(item, 'tuanjieHub.date')
        if date_val is None:
            date_val = extract_nested_value(item, 'newUser.date')
        dates.append(date_val)

    # 定义各Sheet的列和提取路径
    sheets_spec = {
        '团结日活': {
            'columns': ['日期', '用户数', '打开AI人数', '消耗token人数'],
            'paths': ['date', 'tuanjieHub.user', 'tuanjieHub.cowork', 'tuanjieHub.token']
        },
        '团结新增': {
            'columns': ['日期', '用户数', '打开AI人数', '消耗token人数'],
            'paths': ['date', 'newTuanjieHub.user', 'newTuanjieHub.cowork', 'newTuanjieHub.token']
        },
        'Unity新增': {
            'columns': ['日期', '用户数', '打开AI人数', '消耗token人数'],
            'paths': ['date', 'newUnityHub.user', 'newUnityHub.cowork', 'newUnityHub.token']
        },
        'Codely日活': {
            'columns': ['日期', '活跃用户数', '打开团结人数', '打开Unity人数'],
            'paths': ['date', 'cowork.user', 'cowork.tuanjieHub', 'cowork.unityHub']
        },
        'Codely新增': {
            'columns': ['日期', '新增用户数', '消耗token用户数', '新增用户打开团结人数', '消耗token用户打开团结人数'],
            'paths': ['date', 'newCowork.user', 'newCowork.active', 'newCowork.tuanjieHub', 'newCowork.activeTuanjieHub']
        }
    }

    # 构建每个Sheet的DataFrame
    sheet_dfs = {}
    for sheet_name, spec in sheets_spec.items():
        col_data = {}
        for col, path in zip(spec['columns'], spec['paths']):
            if path == 'date':
                col_data[col] = dates
            else:
                col_data[col] = [extract_nested_value(item, path) for item in data]
        sheet_dfs[sheet_name] = pd.DataFrame(col_data)

    # 写入Excel
    output_file = 'output.xlsx'
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        for sheet_name, df in sheet_dfs.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)

    print(f"Excel文件已生成: {output_file}")

if __name__ == "__main__":
    main()
