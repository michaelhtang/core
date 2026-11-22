// swift cutout.swift in.png out.png   Lifts the subject off its background with the Mac's own Vision framework and writes an RGBA PNG.
import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let input = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else { print("usage: swift cutout.swift in.png out.png"); exit(2) }
let handler = VNImageRequestHandler(ciImage: input)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let result = request.results?.first else { print("no subject found"); exit(1) }
let maskBuffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: maskBuffer)
let filter = CIFilter(name: "CIBlendWithMask")!
filter.setValue(input, forKey: kCIInputImageKey)
filter.setValue(CIImage(color: .clear).cropped(to: input.extent), forKey: kCIInputBackgroundImageKey)
filter.setValue(mask, forKey: kCIInputMaskImageKey)
let context = CIContext()
let out = filter.outputImage!
try context.writePNGRepresentation(of: out, to: URL(fileURLWithPath: args[2]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
print("wrote \(args[2]) (\(result.allInstances.count) subject(s))")
