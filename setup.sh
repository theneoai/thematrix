#!/bin/bash
#
# TheMatrix CLI 设置脚本
# 用法: source ./setup.sh [选项]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_PACKAGE="@thematrix/cli"
CLI_PATH="$SCRIPT_DIR/apps/cli"

echo "🚀 TheMatrix CLI 设置脚本"
echo "=========================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查是否在正确的目录
if [ ! -f "$SCRIPT_DIR/package.json" ]; then
    echo -e "${RED}❌ 错误: 请在项目根目录运行此脚本${NC}"
    exit 1
fi

# 检查 pnpm 是否安装
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ 错误: 未找到 pnpm，请先安装 pnpm${NC}"
    echo "   安装方式: npm install -g pnpm"
    exit 1
fi

# 检查依赖是否安装
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo -e "${YELLOW}⚠️  依赖未安装，正在安装...${NC}"
    pnpm install
fi

# 检查是否已构建
if [ ! -f "$CLI_PATH/dist/index.js" ]; then
    echo -e "${YELLOW}⚠️  CLI 未构建，正在构建...${NC}"
    pnpm build
fi

# 显示使用方式
echo ""
echo -e "${BLUE}📖 使用方式:${NC}"
echo "=========================="

# 方式 1: pnpm exec
echo -e "${GREEN}方式 1: 使用 pnpm exec (推荐)${NC}"
echo "   pnpm exec matrix --help"
echo "   pnpm exec matrix init my-project"
echo ""

# 方式 2: 全局链接
echo -e "${GREEN}方式 2: 全局链接${NC}"
echo "   cd apps/cli && pnpm link --global"
echo "   # 之后可以直接使用: matrix --help"
echo ""

# 方式 3: 直接运行
echo -e "${GREEN}方式 3: 直接运行构建文件${NC}"
echo "   node apps/cli/dist/index.js --help"
echo ""

# 方式 4: 创建别名
echo -e "${GREEN}方式 4: 创建 shell 别名${NC}"
echo "   alias matrix='pnpm exec matrix'"
echo "   # 添加到 ~/.bashrc 或 ~/.zshrc 使其永久生效"
echo ""

# 询问用户选择
echo -e "${BLUE}🔧 快捷设置选项:${NC}"
echo "1) 使用 pnpm exec (当前会话)"
echo "2) 全局链接 (推荐，可在任何地方使用)"
echo "3) 创建 shell 别名"
echo "4) 仅显示使用说明"
echo ""

read -p "请选择 [1-4]: " choice

case $choice in
    1)
        echo -e "${GREEN}✅ 已配置 pnpm exec${NC}"
        echo ""
        echo "使用方法:"
        echo "  pnpm exec matrix --help"
        echo ""
        echo "或添加以下别名到你的 shell 配置文件:"
        echo "  alias matrix='pnpm exec matrix'"
        ;;
    2)
        echo -e "${YELLOW}🔗 正在创建全局链接...${NC}"
        cd "$CLI_PATH"
        pnpm link --global
        echo -e "${GREEN}✅ 全局链接创建成功!${NC}"
        echo ""
        echo "现在可以在任何地方使用 'matrix' 命令了"
        echo "测试: matrix --help"
        ;;
    3)
        echo ""
        echo -e "${BLUE}请手动添加以下别名到你的 shell 配置文件:${NC}"
        echo ""
        echo "# For bash (~/.bashrc):"
        echo "alias matrix='pnpm exec matrix'"
        echo ""
        echo "# For zsh (~/.zshrc):"
        echo "alias matrix='pnpm exec matrix'"
        echo ""
        echo "添加后运行: source ~/.bashrc 或 source ~/.zshrc"
        ;;
    4)
        echo ""
        echo -e "${BLUE}📚 使用说明已显示完毕${NC}"
        ;;
    *)
        echo -e "${YELLOW}⚠️  无效选择，使用默认方式 (pnpm exec)${NC}"
        ;;
esac

echo ""
echo -e "${GREEN}🎉 设置完成!${NC}"
echo ""
echo "快速测试:"
echo "  pnpm exec matrix --help"
echo ""
