export function generateFbxDataUri(): string {
    return `data:application/octet-stream;base64,${btoa(generateFbxData())}`;
}

export function generateFbxData(): string {
    return `; FBX 7.4.0 project file
GlobalSettings:  {
    Version: 1000
    Properties70:  {
        P: "UpAxis", "int", "Integer", "",1
        P: "UpAxisSign", "int", "Integer", "",1
        P: "FrontAxis", "int", "Integer", "",2
        P: "FrontAxisSign", "int", "Integer", "",1
        P: "CoordAxis", "int", "Integer", "",0
        P: "CoordAxisSign", "int", "Integer", "",1
    }
}
Objects:  {
    Geometry: 1, "Geometry::Triangle", "Mesh" {
        Vertices: *9 {
            a: 0,0,0,1,0,0,0,1,0
        }
        PolygonVertexIndex: *3 {
            a: 0,1,-3
        }
        LayerElementNormal: 0 {
            MappingInformationType: "ByControlPoint"
            ReferenceInformationType: "Direct"
            Normals: *9 {
                a: 0,0,1,0,0,1,0,0,1
            }
        }
    }
    Model: 2, "Model::Triangle", "Mesh" {
    }
}
Connections:  {
    C: "OO", 1, 2
    C: "OO", 2, 0
}`;
}
