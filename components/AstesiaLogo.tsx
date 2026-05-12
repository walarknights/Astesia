import Svg, { Circle, Ellipse, Path, Polygon } from 'react-native-svg';

type AstesiaLogoProps = {
  size?: number;
  backgroundColor?: string;
  primaryColor?: string;
  secondaryColor?: string;
};

export function AstesiaLogo({
  size = 100,
  backgroundColor = '#66b3ff',
  primaryColor = '#FFFFFF',
  secondaryColor = '#1A2B4C',
}: AstesiaLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 500 500">
      {/* 背景层 */}
      <Circle cx="250" cy="250" r="250" fill={backgroundColor} />

      {/* 外围罗盘与边界 */}
      <Circle cx="250" cy="250" r="235" fill="none" stroke={primaryColor} strokeWidth="2" />
      <Circle cx="250" cy="250" r="225" fill="none" stroke={primaryColor} strokeWidth="5" />
      <Circle
        cx="250"
        cy="250"
        r="212"
        fill="none"
        stroke={primaryColor}
        strokeWidth="1.5"
        strokeDasharray="3 9"
      />

      {/* 四大方位 */}
      <Polygon points="250,5 260,25 250,45 240,25" fill={primaryColor} />
      <Polygon points="250,495 260,475 250,455 240,475" fill={primaryColor} />
      <Polygon points="5,250 25,240 45,250 25,260" fill={primaryColor} />
      <Polygon points="495,250 475,240 455,250 475,260" fill={primaryColor} />

      {/* 后方轨道 */}
      <Circle cx="250" cy="250" r="125" fill="none" stroke={primaryColor} strokeWidth="3" />
      <Path d="M 125 250 A 125 35 0 0 1 375 250" fill="none" stroke={primaryColor} strokeWidth="3" />
      <Ellipse
        cx="250"
        cy="250"
        rx="125"
        ry="35"
        transform="rotate(-45 250 250)"
        fill="none"
        stroke={primaryColor}
        strokeWidth="2"
      />
      <Ellipse
        cx="250"
        cy="250"
        rx="125"
        ry="35"
        transform="rotate(45 250 250)"
        fill="none"
        stroke={primaryColor}
        strokeWidth="2"
      />

      {/* 核心指南针指针 */}
      <Polygon points="250,55 275,250 250,445 225,250" fill={primaryColor} />
      <Polygon points="250,70 251.75,250 250,430 248.25,250" fill={secondaryColor} />

      {/* 前方轨道 */}
      <Path
        d="M 125 250 A 125 35 0 0 0 375 250"
        fill="none"
        stroke={backgroundColor}
        strokeWidth="11"
      />
      <Path
        d="M 125 250 A 125 35 0 0 0 375 250"
        fill="none"
        stroke={primaryColor}
        strokeWidth="3"
      />

      {/* 中心星体 */}
      <Circle cx="250" cy="250" r="22" fill={secondaryColor} />
      <Path
        d="M 250 215 Q 250 250 285 250 Q 250 250 250 285 Q 250 250 215 250 Q 250 250 250 215 Z"
        fill={primaryColor}
      />
      <Circle cx="250" cy="250" r="3" fill={secondaryColor} />
    </Svg>
  );
}